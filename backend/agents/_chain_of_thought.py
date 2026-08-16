"""Shared helper that turns ADK Event.content.parts into stream events.

Investigation / Decision / Report agents each iterate `runner.run_async(...)`
and forward a subset of the reasoning trace (Gemini 2.5 thought parts +
function calls) to the SSE stream so operators can watch each agent work.

The output-schema function call — one per LlmAgent, name matching the
agent's `output_key` (or, for the SequentialAgent, its sub-agents'
output_keys) — is filtered because the frontend already renders that as
the final result event (signal.completed / action.proposed / report.completed).
"""
from __future__ import annotations

import json
from typing import Any, Callable, Iterable


def emit_chain_of_thought(
    event: Any,
    *,
    author: str,
    type_prefix: str,
    skip_names: Iterable[str],
    on_event: Callable[[dict[str, Any]], None],
) -> None:
    """Emit `<prefix>.tool_called` and `<prefix>.thought` events for this ADK Event."""
    content = getattr(event, "content", None)
    parts = getattr(content, "parts", None) if content else None
    if not parts:
        return
    skip = frozenset(skip_names)
    for part in parts:
        fc = getattr(part, "function_call", None)
        if fc is not None and fc.name and fc.name not in skip:
            args = fc.args or {}
            args_json = json.dumps(args, default=str, separators=(",", ":"))
            if len(args_json) > 240:
                args_json = args_json[:237] + "..."
            on_event({
                "type": f"{type_prefix}.tool_called",
                "data": {
                    "author": author or type_prefix,
                    "tool": fc.name,
                    "args_preview": args_json,
                },
            })
            continue
        text = getattr(part, "text", None)
        if text and getattr(part, "thought", False):
            snippet = text.strip()
            if len(snippet) > 400:
                snippet = snippet[:397] + "..."
            on_event({
                "type": f"{type_prefix}.thought",
                "data": {
                    "author": author or type_prefix,
                    "text": snippet,
                },
            })
