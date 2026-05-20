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

- `src/index.js` — Worker (routes, webhook, cron, /data, inline HTML dashboard).
- `scripts/import-csv.mjs` — one-shot CSV → D1 importer (run by workflow 08).
- `scripts/backfill-rooms.mjs` — UPDATE script for historical rows (workflow 09).
- `data/historical/` — CSV history files + `_mapping.json` (file → device_id, room).
- `docs/db_setup.sql` — schema (applied by workflow 02).
- `wrangler.toml` — Cloudflare config; `database_id` is patched in by workflow 02
  if it still contains `REPLACE_WITH_ACTUAL_ID`.
