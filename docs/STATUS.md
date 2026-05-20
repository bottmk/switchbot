# STATUS — handoff snapshot

> Last updated: 2026-05-20. Update this file whenever branch / commits / deploys move.

## Branch & PR

- Working branch: `claude/switchbot-turso-setup-nk30n`
- Open PR: bottmk/switchbot#5 (against main)
- Latest commit on branch: **`296cef7`** — `fix(dashboard): respect period selector for
  3d/7d (was capped at 24h)` — **NOT yet deployed to Cloudflare**.

## Deployment status

- Cloudflare Worker is deployed at HEAD prior to `296cef7`. The LIMIT fix won't take
  effect for end users until `04-deploy.yml` is dispatched.
- D1 database (`switchbot-logs`) schema is initialized and populated.

## D1 data inventory (as of handoff)

Row counts by `source`:

| source   | rows   | notes                                                       |
|----------|--------|-------------------------------------------------------------|
| cron     | ~10    | 10-min poll, increasing                                     |
| webhook  | 354    | from SwitchBot webhook callbacks                            |
| import   | 11,860 | one-shot CSV history (only CA5F44864E85 imported so far)    |

- All `room='unknown'` rows have been backfilled to real room names by workflow 09.
- Remaining `room='unknown'` rows in DB are SMOKE:TEST artifacts only; safe to ignore.

## Devices

3 SwitchBot 温湿度センサ producing readings:

- `CA5F44864E85` — 防水温湿度計 85
- `CF173FA3A137` — 温湿度計 37
- `D02818142841` — 防水温湿度計 41

4th SwitchBot device `DF7AEE48D46C` is a Hub Mini — appears in API listings but does
not produce temperature/humidity readings. The Worker filters it out automatically.

## Pending tasks

### To dispatch (user-manual; no automation has access to gh CLI)

- **04-deploy.yml** — push `296cef7` to Cloudflare so the /data LIMIT fix takes effect.
  `gh workflow run 04-deploy.yml --ref claude/switchbot-turso-setup-nk30n`
- (Optional) **09-backfill-rooms.yml** — idempotent; can be re-run anytime if new
  `room='unknown'` rows accumulate.

### Open work items

- **C-2**: Add 2 more historical CSV files (for `CF173FA3A137` and `D02818142841`)
  under `data/historical/`, then update `data/historical/_mapping.json`, then dispatch
  `08-import-history.yml`. The CSV importer is idempotent (DB-level UNIQUE INDEX +
  cutoff filter) so re-runs are safe.
- **E (low priority)**: Suppress halt-comment noise in workflows 06 / 07. The new
  loop-guard rarely halts now, so the noise is low-impact and not urgent.
- **Verify the LIMIT fix**: after dispatching 04-deploy, open the dashboard, switch to
  3d and 7d periods, and confirm the row counts shown on the chart match expectations
  (should be way more than 24h-window had).

## Recent commit timeline (top 10)

```
296cef7  fix(dashboard): respect period selector for 3d/7d (was capped at 24h)
2ba3f89  Add 09-backfill-rooms: one-shot UPDATE for room='unknown' rows
c05d033  Drop author-count gate; halt only on (S1 AND S2) OR S3
ec68922  Add S3 (CI failure streak) to loop guard as OR gate
94be18f  Add S2 (commit message duplication) to loop guard as additional AND gate
296beee  Add S1 (file-set churn) to loop guard as AND gate
e0c5179  Raise loop-guard threshold from 3 to 10 consecutive Claude commits
e76d32e  Include 'import' rows in cutoff to make 08 idempotent on re-run
78d31ef  Add CSV history importer (workflow 08 + import-csv.mjs)
44eacd1  Implement Option D: auto-discover devices from SwitchBot API (no DEVICES Secret)
```
