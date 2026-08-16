"""Standalone MCP proof: one ADK agent asks mcp-clickhouse to list tables.

This is the de-risk step called out in BUILD_REPORT §4. It verifies:
  1. mcp-clickhouse spawns and speaks MCP over stdio
  2. ADK's MCPToolset connects and discovers tools
  3. Gemini can select the right tool and get a valid response
  4. The whole thing exits cleanly

Usage (from backend/):
    ./venv/bin/python -m mcp_integration.proof

Exit 0 on success (prints tool call + tables). Non-zero on any failure.
"""

from __future__ import annotations

import asyncio
import os
import sys

from google.adk.agents.llm_agent import LlmAgent
from google.adk.runners import InMemoryRunner
from google.genai import types

from mcp_integration.client import build_toolset


PROOF_INSTRUCTION = """\
You are a ClickHouse operator proving that MCP integration works.
Step 1: Call the list_databases tool (no arguments).
Step 2: Pick the first user database from the result (skip system/information_schema/INFORMATION_SCHEMA).
Step 3: Call list_tables with database=<that name>.
Step 4: In one sentence, name 3-5 of the tables you saw.
Do NOT call run_query. Do NOT ask for permission. Do NOT ask clarifying questions.
"""


async def _run_proof() -> int:
    toolset = build_toolset()
    agent = LlmAgent(
        name="mcp_proof",
        model=os.environ.get("GEMINI_MODEL_FLASH", "gemini-2.5-flash-preview-05-20"),
        instruction=PROOF_INSTRUCTION,
        tools=[toolset],
    )
    runner = InMemoryRunner(agent=agent, app_name="mcp_proof")

    session = await runner.session_service.create_session(
        app_name="mcp_proof", user_id="proof-user"
    )

    saw_tool_call = False
    saw_response = False
    async for event in runner.run_async(
        user_id="proof-user",
        session_id=session.id,
        new_message=types.Content(
            role="user",
            parts=[types.Part.from_text(text="List the tables.")],
        ),
    ):
        # Print a compact trace line per event.
        author = event.author or "?"
        if event.content and event.content.parts:
            for part in event.content.parts:
                if part.function_call:
                    saw_tool_call = True
                    print(f"[{author}] tool_call: {part.function_call.name}"
                          f"({part.function_call.args})")
                elif part.function_response:
                    resp = part.function_response.response
                    resp_str = str(resp)[:200]
                    print(f"[{author}] tool_response: {resp_str}...")
                elif part.text:
                    saw_response = True
                    print(f"[{author}] text: {part.text.strip()}")

    if not saw_tool_call:
        print("FAIL: no tool call observed — MCPToolset did not surface tools",
              file=sys.stderr)
        return 1
    if not saw_response:
        print("FAIL: no final text response from model", file=sys.stderr)
        return 1
    print("\nOK — mcp-clickhouse spawned, tools listed, Gemini answered.")
    return 0


def main() -> None:
    code = asyncio.run(_run_proof())
    sys.exit(code)


if __name__ == "__main__":
    main()
