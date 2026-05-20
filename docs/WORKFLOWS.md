# WORKFLOWS — `.github/workflows/` inventory

One paragraph per workflow. "Triggers" lists every way the workflow can fire.
"Dispatched by" = who in practice runs it.

## 00-test.yml — Tests

- **Triggers**: `workflow_dispatch` + `push` to `claude/switchbot-turso-setup-nk30n`
  on changes under `src/**`, `test/**`, `package.json`, `package-lock.json`, or
  `.github/workflows/00-test.yml`.
- **Dispatched by**: automatic (push); user can also re-run manually.
- **Purpose**: `npm install && npm test`. Runs unit tests for normalization /
  helper logic. **No loop-guard** — tests don't push back, so there's no risk of
  infinite loops, and we always want to know if invariants break.

## 01-diagnose.yml — Diagnose

- **Triggers**: `workflow_dispatch` + `push` to the working branch when paths under
  `src/**`, `scripts/**`, `docs/db_setup.sql`, `wrangler.toml`, or the workflow
  file itself change.
- **Dispatched by**: automatic on push; user manually as needed.
- **Purpose**: runs the loop-guard pre-check, then diagnostics (env sanity,
  secret-length checks, `wrangler whoami`, account-id verification, DEVICES JSON
  validation, etc.). Posts a comment to the tracker PR.

## 02-init-d1.yml — Initialize D1 database

- **Triggers**: `workflow_dispatch` only.
- **Dispatched by**: user (one-shot, but safe to re-run).
- **Purpose**: create the `switchbot-logs` D1 database (if missing), patch
  `database_id` into `wrangler.toml`, apply `docs/db_setup.sql` schema.
  `permissions: contents: write` because it commits the wrangler.toml change back.

## 03-set-secrets.yml — Set Cloudflare Worker secrets

- **Triggers**: `workflow_dispatch` only.
- **Dispatched by**: user, after rotating secrets.
- **Purpose**: `wrangler secret put` for each Worker secret (SwitchBot token /
  secret, etc.) using the corresponding GitHub Actions secret as input. See
  `docs/deploy-setup.md` for the secret list.

## 04-deploy.yml — Deploy Worker

- **Triggers**: `workflow_dispatch` only.
- **Dispatched by**: user, after merging or testing changes.
- **Purpose**: `wrangler deploy`. Pushes the current branch's Worker code to
  Cloudflare. This is the workflow needed to make commit `296cef7` (LIMIT fix)
  go live.

## 05-register-webhook.yml — Register webhook → Issue

- **Triggers**: `workflow_dispatch` with optional `worker_subdomain` input
  (blank = auto-derive).
- **Dispatched by**: user, once after first deploy or when re-registering.
- **Purpose**: hits the SwitchBot API to register / update the webhook callback
  URL pointing at the Worker. Posts the result as a GitHub Issue comment.

## 06-smoke-test.yml — Smoke test → Issue

- **Triggers**: `workflow_dispatch` + `push` on the working branch when paths
  under `src/**`, `scripts/**`, or the workflow file change.
- **Dispatched by**: automatic on push; user as needed.
- **Purpose**: runs the loop-guard, then an end-to-end smoke test (hit live
  endpoints, sanity check responses). Scrubs secrets from log output. Posts the
  result to the tracker PR (falls back to an Issue if no tracker PR is found).

## 07-diag-to-issue.yml — Diag → Issue

- **Triggers**: `workflow_dispatch` + `push` on the working branch when paths
  under `src/**`, `scripts/**`, `docs/db_setup.sql`, `wrangler.toml`, or the
  workflow file change.
- **Dispatched by**: automatic on push; user as needed.
- **Purpose**: runs the loop-guard, then a richer diagnostic capture (all
  diagnostics into `/tmp/diag.log`, scrubbed for secrets), then posts the log to
  the tracker PR (or fallback Issue). Closely related to 01 but with fuller log
  posting.

## 08-import-history.yml — Import CSV history → D1

- **Triggers**: `workflow_dispatch` only.
- **Dispatched by**: user, after adding new CSVs to `data/historical/` and
  updating `_mapping.json`.
- **Purpose**: runs `scripts/import-csv.mjs`. Idempotent — safe to re-run.
  See `docs/DESIGN.md` § "CSV import idempotency" for the three layers of
  duplicate protection. Uses `concurrency: group: import-${ref},
  cancel-in-progress: false`.

## 09-backfill-rooms.yml — Backfill room names in D1

- **Triggers**: `workflow_dispatch` only.
- **Dispatched by**: user, ad hoc (idempotent).
- **Purpose**: runs `scripts/backfill-rooms.mjs`, which `UPDATE`s any rows where
  `room='unknown'` to the resolved room name from the SwitchBot API. Safe to run
  repeatedly. Uses `concurrency: group: backfill-${ref}`.

## deploy.yml — Deploy to Cloudflare Workers (legacy combined)

- **Triggers**: `workflow_dispatch` only, with a boolean input
  `register_webhook` (default `false`).
- **Dispatched by**: user, but mostly **superseded** by the split 02 / 03 / 04 /
  05 workflows.
- **Purpose**: combined "do everything" pipeline — initializes D1 if needed
  (patches `wrangler.toml` and commits it back), installs deps, deploys the
  Worker, and optionally re-registers the webhook. Kept around as a fallback;
  prefer the split workflows for normal use.
