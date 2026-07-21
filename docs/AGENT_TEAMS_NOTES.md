# Agent Teams — operational notes

Notes for working with (or around) the Agent Teams experimental feature in
Claude Code on the web.

## Activation requirements

Two gates must both be open:

1. **Client-side env**: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` must be set in
   `~/.claude/settings.json` (already configured in this environment).
2. **Server-side flag**: the `tengu_amber_flint` statsig feature flag must be on
   for the current user / session. This is server-controlled.

Official docs: https://code.claude.com/docs/en/agent-teams

## Observed behavior in this session

- The MCP server that exposes `TeamCreate` / `SendMessage` / `TeamDelete`
  **disconnects mid-session**. Best theory: the disconnect is tied to session-ID
  rotation that happens during context compaction. Once it disconnects, it does
  **not** reconnect within the same session.
- The `Agent` tool's schema in this session did not expose `team_name` /
  `name` parameters, which suggests the `tengu_amber_flint` statsig gate is also
  closed here. (When the flag is on, those params should appear.)

## Implications

- **Teams works best in short, fresh sessions.** A long-running session that
  accumulates context (and triggers compactions) is likely to lose the MCP
  connection.
- Don't plan a long workflow around persistent team agents. Treat any team you
  create as expendable — its lifetime may be cut short.

## Workaround used in this session

We fell back to **ephemeral sub-agents via the standard `Agent` tool** (no
`team_name` / `name` parameters):

- One `Agent` invocation per task.
- Sub-agents do not share context with the parent or with each other.
- Each sub-agent prompt must be **fully self-contained** — include all design
  context, file paths, constraints, and acceptance criteria.

## Recommended operational pattern (going forward)

1. Try Agent Teams first **only** if the session is fresh and short.
2. If Teams aren't available (no `team_name` in Agent schema, or MCP disconnect),
   default to **ephemeral sub-agents**:
   - Compose a self-contained prompt for each task.
   - Spawn multiple independent sub-agents in parallel when work is parallelizable.
   - Coordinate from the parent thread; keep the parent free of heavy
     implementation work so context lasts longer.
3. Commits and pushes happen inside sub-agent threads. Remind sub-agents to use
   the session footer trailer in commit messages:
   `https://claude.ai/code/session_01KsHM7BHiN9RsyEqZZKZUSy`.
