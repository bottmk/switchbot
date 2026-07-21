# switchbot project

SwitchBot 温湿度センサ → Cloudflare Worker → D1 logger. Dashboard at the Worker root URL.
Worker source: `src/index.js`. D1 database: `switchbot-logs`. Webhook ingest + 10-min cron
poll + one-shot CSV history import.

## Read these on session start

- Current state & pending work: [docs/STATUS.md](docs/STATUS.md)
- Design decisions & rationale: [docs/DESIGN.md](docs/DESIGN.md)
- Workflow inventory: [docs/WORKFLOWS.md](docs/WORKFLOWS.md)
- Agent Teams limitations: [docs/AGENT_TEAMS_NOTES.md](docs/AGENT_TEAMS_NOTES.md)
- DB schema: [docs/db_setup.sql](docs/db_setup.sql)
- Coding conventions (JP): [docs/conventions.md](docs/conventions.md)
- Deploy / Secrets setup (JP): [docs/deploy-setup.md](docs/deploy-setup.md)

## Operating rules

- Work in branches; primary working branch is `claude/switchbot-turso-setup-nk30n`.
- Delegate implementation work to sub-agents via the Agent tool. Don't do heavy lifting
  in the parent thread — keep the parent for coordination and chat.
- Each sub-agent gets a self-contained prompt with full task context (they don't see
  your conversation history).
- The user dispatches workflows manually (no `gh` CLI / GITHUB_TOKEN available to the
  parent or sub-agents). Provide the exact `gh workflow run ...` command when asking
  the user to dispatch.
- Commit + push happen in sub-agent threads. Always include the session footer trailer
  in commit messages: https://claude.ai/code/session_01KsHM7BHiN9RsyEqZZKZUSy

## Quick facts (snapshot — see STATUS.md for the live values)

- Branch: `claude/switchbot-turso-setup-nk30n`
- Latest commit at handoff: `296cef7` (LIMIT fix for /data endpoint — NOT yet deployed)
- Open PR: bottmk/switchbot#5
- 3 reading devices: CA5F44864E85, CF173FA3A137, D02818142841. Hub Mini DF7AEE48D46C
  is present but produces no readings.
- DEVICES Secret is no longer read by the Worker (auto-discover via SwitchBot API).
