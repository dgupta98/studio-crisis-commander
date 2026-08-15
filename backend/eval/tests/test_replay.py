"""Replay executor reads cached triples and returns the primary_cause."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from eval.replay import CachedTripleMissing, make_replay_executor
from eval.scenarios import Scenario


def _mk_scenario(sid: str, ctype: str = "refund_spike") -> Scenario:
    return Scenario(
        id=sid, crisis_type=ctype,  # type: ignore[arg-type]
        film_id=1, region="US", magnitude=0.3,
        expected_primary_cause=ctype,  # type: ignore[arg-type]
    )


def _mk_triple(primary_cause: str) -> dict:
    """Minimal-shape triple. Only investigation.hypothesis.primary_cause matters."""
    return {"investigation": {"hypothesis": {"primary_cause": primary_cause}}}


@pytest.mark.asyncio
async def test_replay_returns_primary_cause(tmp_path):
    (tmp_path / "sc_001.json").write_text(json.dumps(_mk_triple("Refund spike observed.")))
    exec_ = make_replay_executor(cache_dir=tmp_path)
    out = await exec_(_mk_scenario("sc_001"))
    assert out.primary_cause == "Refund spike observed."
    assert out.errored is False


@pytest.mark.asyncio
async def test_replay_missing_cache_raises(tmp_path):
    exec_ = make_replay_executor(cache_dir=tmp_path)
    with pytest.raises(CachedTripleMissing) as exc:
        await exec_(_mk_scenario("sc_missing"))
    assert "sc_missing" in str(exc.value)
