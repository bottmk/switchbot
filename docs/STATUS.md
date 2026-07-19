# STATUS — handoff snapshot

> Last updated: 2026-07-19. Update this file whenever branch / commits / deploys move.

## Branch & PR

- **Canonical branch: `claude/switchbot-turso-setup-nk30n`.** Development was
  consolidated here — `claude/switchbot-continuation-90uc17` is retired (all of its
  work is merged into turso; do not develop on it).
- Latest commit: **`7a97c73`** — `feat(auth): require login for all pages except the
  webhook; deploy on turso` — **deployed** (Worker Version `509450f9`).
- `origin/main` is stale (predates the SwitchBot control/automation/auth work); no PR
  to main has been opened for the current line.

## Deployment status — now automatic

- **Push to `turso` (or `continuation`) auto-deploys** via `04-deploy.yml` (push
  trigger on `src/**`, `wrangler.toml`, `package.json`, `04-deploy.yml`). Also fires on
  `01: Diagnose` success. Manual `gh workflow run 04-deploy.yml` still works.
- `04-deploy.yml` **syncs secrets into the Worker on every deploy** (guarded — skipped
  if the repo secret is unset): `CONTROL_SECRET` and `DASHBOARD_PASSWORD`.
- Cloudflare API token was rotated on 2026-07-19 (token name `gentle-limit-96c2`) after
  the previous one expired; stored as GitHub secret `CLOUDFLARE_API_TOKEN`.
- D1 database (`switchbot-logs`, id `0688f834-…`) schema initialized and populated.

## Endpoints (production)

`https://switchbot-temperature-logger.bottmk.workers.dev/`

| Route | Purpose | Access |
|-------|---------|--------|
| `/`, `/data` | dashboard + readings JSON | login (cookie) |
| `/settings` | fan-automation config UI | login |
| `/devices/all` | full device inventory (incl. circulator, IR remotes) | login |
| `/devices/status?id=` | raw `/status` for any device | login |
| `/config` GET / POST | read / save fan config | GET: login · POST: login + `CONTROL_SECRET` |
| `/control` | manual device command | login + `CONTROL_SECRET` |
| `/login`, `/logout` | session cookie | public |
| `/webhook/…` | SwitchBot ingest | public (must stay open) |

## Access control

- **Login gate** (`src/auth.js`): shared `DASHBOARD_PASSWORD`, 30-day signed-cookie
  session. A single guard at the top of `fetch()` requires a session for every route
  except `/login`, `/logout`, `/webhook/*`.
- **Control key** (`CONTROL_SECRET`): required in addition to login for anything that
  actuates hardware or writes config (`/control`, POST `/config`). Fail-safe: if
  `CONTROL_SECRET` is unset the control/save paths return 403.

## Devices

3 温湿度センサ (meters) producing readings:

- `CA5F44864E85` — 防水温湿度計 85
- `CF173FA3A137` — 温湿度計 37 — **bedroom sensor** used by fan automation
- `D02818142841` — 防水温湿度計 41

Other devices (via `/devices/all`): `B0E9FEF98348` サーキュレーター2 Pro 48
(`Battery Circulator Fan 2 Pro`, `enableCloudService:true`, controllable),
`DF7AEE48D46C` Hub Mini (no readings, filtered out of the poll), plus IR remotes.

## Fan automation (Step 3)

- Config persisted in D1 table `app_config` (key `fan_automation`), edited from
  `/settings`, evaluated every 10 min in the cron (`src/config.js` `decideFanAction`).
- Fields: `enabled`, `fanDeviceId`, `sensorDeviceId`, `onC`, `offC`, `night`
  (`allday` / `no-on` / `off`). **Default `enabled:false`** — nothing actuates until
  turned on in the UI.
- Safety: hysteresis band (offC < onC), night-window policy (23:00–07:00 JST), and the
  cron reads the fan's actual `power` before sending, so no repeated commands and manual
  changes inside the band are respected.

## Pending / open items

- **User to verify live**: login works, `/settings` now requires login, dashboard loads,
  and new rows keep arriving (webhook/cron not broken by the auth guard).
- **Enable automation**: log in → `/settings` → pick sensor (温湿度計 37) + fan
  (サーキュレーター2 Pro 48), set thresholds (decide from the dashboard graph), enable, save.
- **Multi-session coordination**: more than one session may push to `turso` — always
  `git pull --ff-only` before pushing.
- **C-2** (carried over): import historical CSV for `CF173FA3A137` / `D02818142841`
  (`data/historical/` + `_mapping.json`, then `08-import-history.yml`). Importer is
  idempotent.
- **main**: no PR opened for the current work; open one when ready to promote.

## Recent commit timeline (top 10)

```
7a97c73  feat(auth): require login for all pages except the webhook; deploy on turso
bb31d7c  merge: integrate continuation-90uc17 (fan automation/control/settings)
d726f27  feat(dashboard): password-gate the temperature dashboard
a13497d  feat(settings): self-serve UI + D1-persisted fan automation (Step 3)
7de4309  ci(deploy): sync CONTROL_SECRET from repo secret into the Worker
21a0f3b  feat(control): add secret-gated device control + raw status (Step 2)
56d6857  ci(deploy): also auto-deploy the active continuation branch
12d1956  ci(deploy): trigger 04-deploy on push to working branch
4b48a8b  feat(switchbot): add read-only /devices/all to discover controllable devices
8e2f89e  Add repo .claude/settings.json to enable Agent Teams in fresh sessions
```
