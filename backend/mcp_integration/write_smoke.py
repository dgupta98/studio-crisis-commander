"""Layer 3b build-risk smoke test.

Layer 3b needs to INSERT audit rows via MCP. mcp-clickhouse 0.4.1 defaults
to readonly mode. This script proves whether writes succeed with the
CLICKHOUSE_READONLY_MODE=0 env flip, or whether audit.py must fall back
to clickhouse-connect (spec §6.4 fallback path).

Exit 0 => MCP writes work. Design proceeds with MCP for audit.
Exit 2 => MCP writes blocked. Design falls back to clickhouse-connect
          for audit INSERTs only (documented in agents/decision/audit.py).
"""

from __future__ import annotations

import asyncio
import os
import sys
import uuid

from google.adk.agents.llm_agent import LlmAgent
from google.adk.runners import InMemoryRunner
from google.genai import types

from mcp_integration.client import build_toolset


TEST_TABLE = "_layer3b_write_smoke"


async def main() -> int:
    # Force write mode on the MCP subprocess.
    os.environ["CLICKHOUSE_READONLY_MODE"] = "0"

    marker = uuid.uuid4().hex
    ddl = f"CREATE TABLE IF NOT EXISTS {TEST_TABLE} (marker String) ENGINE = Memory"
    ins = f"INSERT INTO {TEST_TABLE} VALUES ('{marker}')"
    sel = f"SELECT marker FROM {TEST_TABLE} WHERE marker = '{marker}'"
    drop = f"DROP TABLE IF EXISTS {TEST_TABLE}"

    agent = LlmAgent(
        name="write_smoke",
        model=os.environ.get("GEMINI_MODEL_FLASH", "gemini-2.5-flash-preview-05-20"),
        instruction=(
            "Call run_query with EACH of the following SQL statements in order. "
            "Return only 'OK' after the last one succeeds.\n"
            f"1) {ddl}\n2) {ins}\n3) {sel}\n4) {drop}\n"
        ),
        tools=[build_toolset()],
    )
    runner = InMemoryRunner(agent=agent, app_name="write_smoke")
    session = await runner.session_service.create_session(
        app_name="write_smoke", user_id="smoke"
    )

    saw_select_result = False
    error_text = ""
    async for event in runner.run_async(
        user_id="smoke",
        session_id=session.id,
        new_message=types.Content(
            role="user",
            parts=[types.Part.from_text(text="Run the statements.")],
        ),
    ):
        if event.content and event.content.parts:
            for part in event.content.parts:
                if part.function_response:
                    payload = str(part.function_response.response)
                    if marker in payload:
                        saw_select_result = True
                    lower = payload.lower()
                    if "readonly" in lower or "denied" in lower or "not allowed" in lower:
                        error_text = payload[:400]

    if saw_select_result:
        print("MCP-WRITE-OK: INSERT + SELECT roundtrip succeeded with CLICKHOUSE_READONLY_MODE=0.")
        return 0
    print("MCP-WRITE-BLOCKED: could not observe INSERTed marker in SELECT result.", file=sys.stderr)
    if error_text:
        print(f"  hint: {error_text}", file=sys.stderr)
    print("  → agents/decision/audit.py MUST fall back to clickhouse-connect (spec §6.4).", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
