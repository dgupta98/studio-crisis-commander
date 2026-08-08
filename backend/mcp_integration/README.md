# `mcp_integration/` — Layer 3+ ClickHouse bridge

This package is the ONLY path agent code takes to ClickHouse. Every
Layer 3+ agent's ClickHouse read goes through `mcp-clickhouse` (the
official MCP server) via `MCPToolset` from `google-adk`.

**Boundary rule:** `backend/agents/` and `backend/mcp_integration/`
NEVER import `data.ch_client` or `clickhouse_connect`. Layer 2's
`data.mv.acceptance` §7 grep enforces this (and Layer 3a acceptance §1
enforces the same for the agent tree).

## Contents

| File | Purpose |
|---|---|
| `client.py` | `build_toolset()` — spawns `python -m mcp_clickhouse.main` as stdio subprocess, returns an ADK `MCPToolset`. |
| `proof.py`  | `python -m mcp_integration.proof` — de-risk script; one Gemini call that lists tables via MCP. |
| `tests/`    | Unit tests for env remap; skips CH-dependent tests if `.env` unset. |

## Naming: why `mcp_integration`, not `mcp`

The installed `mcp` package (the official MCP Python SDK) is a top-level
dependency of both `mcp-clickhouse` and ADK's `MCPToolset`. A local
`backend/mcp/` package on `sys.path` would shadow it and break every
ADK import. The name is deliberate.

## Env mapping

`mcp-clickhouse` expects `CLICKHOUSE_DATABASE`; Layer 1/2 use
`CLICKHOUSE_DB`. `client._env_for_subprocess()` remaps this and forces
`CLICKHOUSE_SECURE=true` (ClickHouse Cloud default). `.env` stays
unchanged.

## Running the proof

Prereqs: Layer 1 + Layer 2 both built; `.env` populated; Vertex AI
smoke test green.

```bash
cd backend
./venv/bin/python -m mcp_integration.proof
```

Expected output ends with `OK — mcp-clickhouse spawned, tools listed,
Gemini answered.` Exit 0 = the wire works end-to-end. Any non-zero
exit code should be resolved before touching the Investigation Agent.

## Verified tool names (mcp-clickhouse 0.4.1)

- `list_databases` — no args
- `list_tables(database)` — enumerate tables + schema
- `run_query(query)` — execute SELECT (read-only by default)
