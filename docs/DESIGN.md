# DESIGN — decisions & rationale

The "why" behind non-obvious choices. Update when a decision changes.

## Loop guard (workflows 01-diagnose / 06-smoke-test / 07-diag-to-issue)

**Problem**: push-triggered workflows that comment on a PR can cause Claude Code on
the web to react to its own comments → infinite loop of trivial commits.

**Final design** (current after 5 iterations, commits `e0c5179` → `296beee` →
`94be18f` → `ec68922` → `c05d033`):

Halt the workflow iff **`(THRASH AND DUPMSG) OR S3`**, where:

- **S1 / THRASH** — last 8 Claude-authored commits touched ≤3 unique files
  AND introduced <20 net insertions. Detects narrow-scoped churn.
- **S2 / DUPMSG** — ≥4 of the last 6 Claude commit messages collapse to the same
  normalized skeleton (lowercased, numbers / IDs stripped). Detects repeated
  near-identical messages.
- **S3** — ≥5 of the last 6 runs of the *same* workflow on *this* branch have
  failed. Requires `actions: read` permission and uses `gh` to query run history.

**Why this combination**:
- S1 alone would halt healthy "small fixes" iteration.
- S2 alone would halt cases where the author uses one stock message format.
- S1 AND S2 together is a strong "stuck loop" signal.
- S3 short-circuits when CI itself is broken (no point in continuing).

**What was removed**: an earlier "halt after 10+ consecutive Claude-authored commits"
gate (commit `e0c5179`). It penalized varied, productive iteration. Dropped in
`c05d033`.

**Checkout depth**: each loop-guarded workflow uses `actions/checkout@v4` with
`fetch-depth: 15` so `git log -10` has enough history available.

## Room resolution

**Before** commit `44eacd1`: webhook ingest read a `DEVICES` Secret (a JSON map of
deviceId → room). Only 1 entry was set up, so 2/3 devices wrote `room='unknown'`.

**After** `44eacd1` ("Option D"): the Worker auto-discovers devices via the
SwitchBot REST API on demand and caches the device → room name mapping. The
`DEVICES` Secret is no longer read by code — keeping it set is harmless but it's
not required and should not be relied on.

**Backfill for historical rows**: workflow `09-backfill-rooms.yml` + script
`scripts/backfill-rooms.mjs` (commit `2ba3f89`) ran `UPDATE` statements against the
350-ish historical `unknown` rows. The script is idempotent — re-running it is
safe and a no-op once rooms are resolved.

## CSV import idempotency (workflow 08 / `scripts/import-csv.mjs`)

Three layers of safety, each independent:

1. **DB-level**: `CREATE UNIQUE INDEX IF NOT EXISTS ... ON temperature_logs
   (device_id, timestamp)` plus `INSERT OR IGNORE` for every row. Hard floor.
2. **Filter-level**: compute `cutoff = MIN(timestamp) WHERE source IN
   ('cron','webhook','import')` and only import rows with `timestamp < cutoff`.
   Avoids overlap between historical CSV and live ingest. Including `'import'` in
   the cutoff query (commit `e76d32e`) is what makes re-runs idempotent.
3. **Workflow-level**: `concurrency: group: import-${ref}, cancel-in-progress:
   false` — prevents two import runs from racing.

## Dashboard data fetching (`/data` endpoint)

The endpoint reads rows with `ORDER BY timestamp ASC` plus a `LIMIT`.

**Important property**: if the rows in the requested time window exceed `LIMIT`,
the OLDEST rows are kept and the newest are dropped (because ASC ordering returns
oldest first).

**The 3d/7d bug**: before commit `296cef7`, the default LIMIT was too low (capped
the chart at roughly the most recent 24h regardless of selector). `296cef7` raised
the default to 50000, with a cap of 100000. After deploying, 3d / 7d selectors
display the full window.

Frontend (HTML + chart code) is inlined as a string in `src/index.js`.

## File layout

- `src/index.js` — Worker (routes, access-control guard, webhook, cron, automation).
- `src/switchbot.js` — SwitchBot API: signing, status/list reads, `fetchAllDevices`,
  `fetchRawStatus`, `sendDeviceCommand`.
- `src/auth.js` — dashboard login (shared password + signed session cookie).
- `src/config.js` — D1-backed app config + `decideFanAction` (pure rule).
- `src/settings.js` — `/settings` UI (HTML string).
- `src/dashboard.js` — dashboard UI (HTML string).
- `src/d1.js` / `src/devices.js` — D1 batch insert / device helpers.
- `scripts/import-csv.mjs` — one-shot CSV → D1 importer (run by workflow 08).
- `scripts/backfill-rooms.mjs` — UPDATE script for historical rows (workflow 09).
- `data/historical/` — CSV history files + `_mapping.json` (file → device_id, room).
- `docs/db_setup.sql` — schema (applied by workflow 02).
- `wrangler.toml` — Cloudflare config; `database_id` is patched in by workflow 02
  if it still contains `REPLACE_WITH_ACTUAL_ID`.

## Home automation: sense → decide → act

The goal is home automation; the temperature history is the sensing side and SwitchBot
control is the actuation side. Built in three safe stages ("crawl-walk-run"):

1. **Discover** — `fetchAllDevices` + `GET /devices/all` (read-only) to find the
   circulator's `deviceId` / `deviceType` / `enableCloudService` without the
   meter-only filter that `fetchDeviceList` applies for the poll.
2. **Manual control** — `sendDeviceCommand` (signed POST `/commands`, generic) behind
   `GET|POST /control`. **Fail-safe**: disabled (403) unless `CONTROL_SECRET` is set,
   and every request must carry the matching key. Deploying the code never actuates
   hardware until the operator opts in.
3. **Automation** — the cron evaluates `decideFanAction(config, temp, jstHour)` and
   actuates. `Battery Circulator Fan 2 Pro` commands confirmed in use: `turnOn` /
   `turnOff`; also `setWindMode` (`direct`/`natural`/`sleep`/`baby`) and `setWindSpeed`
   (1–100).

**Rule safety** (`decideFanAction`, a pure function so it is unit-tested):
- **Hysteresis** — ON at `≥ onC`, OFF at `≤ offC`, no change in between; `validateFanConfig`
  forces `offC < onC` so it can never oscillate.
- **Night policy** — window 23:00–07:00 JST; `off` = no automation at night, `no-on` =
  never turn ON at night (still allowed to turn OFF), `allday` = unrestricted.
- **Idempotent actuation** — `runFanAutomation` reads the fan's actual `power` before
  sending, so it never repeats a command and respects manual changes within the band.

## Config persistence (`src/config.js`, D1 `app_config`)

Fan-automation settings live in a tiny key/value table the Worker creates on demand
(`CREATE TABLE IF NOT EXISTS`), **not** in `wrangler.toml` vars. Rationale: the operator
edits thresholds from the `/settings` UI and they must take effect **without a redeploy**
and **survive deploys**. `enabled` defaults to `false` (fail-safe). Writes go through
`POST /config`, gated by `CONTROL_SECRET`.

## Access control (`src/auth.js` + central guard)

`/` and `/data` were public. Access is now a shared **`DASHBOARD_PASSWORD`** login with a
stateless 30-day signed-cookie session (HMAC over an expiry, keyed by the password — no
D1 session store). A single guard at the top of `fetch()` requires a session for **every**
route except `/login`, `/logout`, and `/webhook/*` (the webhook must stay open — SwitchBot
posts to it with no cookie). Hardware/config writes require `CONTROL_SECRET` **in addition**
to login (defence in depth).

## Deploy automation & secret sync (`04-deploy.yml`)

Deploys are push-triggered on the working branch (paths: `src/**`, `wrangler.toml`,
`package.json`, `04-deploy.yml`) plus `01: Diagnose` success — so `git push` reaches
production with no manual dispatch. The workflow also **syncs `CONTROL_SECRET` and
`DASHBOARD_PASSWORD`** into the Worker on each deploy via guarded `wrangler secret put`
(skipped when the repo secret is unset), so the secrets are always provisioned from one
place. `04-deploy` does not comment on PRs, so it is outside the loop-guard concern.

## Branch consolidation

Two sessions worked in parallel (fan automation on `continuation-90uc17`, password auth
on `turso-setup-nk30n`). Because every change was additive, `continuation` merged cleanly
into `turso` (`bb31d7c`). **`turso-setup-nk30n` is now the single canonical branch**;
`continuation` is retired. Multiple sessions on one branch must `git pull --ff-only`
before pushing.
