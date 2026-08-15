"""Runner tests using a fake in-memory executor."""
from __future__ import annotations

import asyncio
import json

import pytest

from eval.runner import ExecutorOutput, run_scenarios, save_artifact
from eval.scenarios import Scenario


def _mk_scenario(idx: int, ctype: str, film_id: int = 1) -> Scenario:
    return Scenario(
        id=f"sc_{idx:03d}",
        crisis_type=ctype,  # type: ignore[arg-type]
        film_id=film_id,
        region="US",
        magnitude=0.3,
        expected_primary_cause=ctype,  # type: ignore[arg-type]
    )


@pytest.mark.asyncio
async def test_runner_all_correct():
    scenarios = [
        _mk_scenario(1, "refund_spike"),
        _mk_scenario(2, "refund_spike"),
    ]

    async def fake(scn: Scenario) -> ExecutorOutput:
        return ExecutorOutput(
            primary_cause="refund spike observed",
            latency_ms=42,
            errored=False,
        )

    art = await run_scenarios(scenarios, executor=fake, mode="replay")
    assert art.total == 2
    assert art.correct == 2
    assert art.errored == 0


@pytest.mark.asyncio
async def test_runner_records_errored():
    scenarios = [_mk_scenario(1, "refund_spike")]

    async def fake(scn: Scenario) -> ExecutorOutput:
        return ExecutorOutput(primary_cause="", latency_ms=0, errored=True)

    art = await run_scenarios(scenarios, executor=fake, mode="live")
    assert art.errored == 1
    assert art.correct == 0
    assert art.scenarios[0].raw_primary_cause == ""


@pytest.mark.asyncio
async def test_save_artifact_writes_json(tmp_path):
    scenarios = [_mk_scenario(1, "refund_spike")]

    async def fake(scn: Scenario) -> ExecutorOutput:
        return ExecutorOutput(primary_cause="refund", latency_ms=1, errored=False)

    art = await run_scenarios(scenarios, executor=fake, mode="replay")
    out = tmp_path / "latest.json"
    save_artifact(art, out)
    parsed = json.loads(out.read_text())
    assert parsed["accuracy"] == 1.0
    assert parsed["mode"] == "replay"
    assert len(parsed["scenarios"]) == 1
