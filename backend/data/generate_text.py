"""Gemini-generated review text for reviews_text (150K rows).

Model: GEMINI_MODEL_FLASH env var (default gemini-2.5-flash-preview-05-20) via
google-genai (Vertex backend, us-east1).
Batch: 25 reviews per API call → 6,000 calls.
Cost cap: aborts if projected spend exceeds $25 (based on token counts).
Resumable: seed/gen_state.json records last completed batch index.
Distribution: 60% baseline, 40% clustered ±48h around seeded crises.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import zlib
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from google import genai
from google.genai import types

from data.ch_client import client, insert_batches
from data.region_split import REGIONS

load_dotenv()

SEED_DIR = Path(__file__).parent / "seed"
STATE_PATH = SEED_DIR / "gen_state.json"

TARGET_ROWS = 150_000
BATCH_SIZE = 25
NUM_BATCHES = TARGET_ROWS // BATCH_SIZE   # 6000
COST_CAP_USD = 25.0

# Approximate Gemini 2.5 Flash pricing (USD per 1M tokens); refresh if pricing changes.
PRICE_IN_PER_M = 0.30
PRICE_OUT_PER_M = 2.50

SCHEMA = types.Schema(
    type=types.Type.OBJECT,
    properties={
        "reviews": types.Schema(
            type=types.Type.ARRAY,
            items=types.Schema(
                type=types.Type.OBJECT,
                properties={
                    "raw_text": types.Schema(type=types.Type.STRING),
                    "sentiment_score": types.Schema(type=types.Type.NUMBER),
                    "themes": types.Schema(
                        type=types.Type.ARRAY,
                        items=types.Schema(type=types.Type.STRING),
                    ),
                },
                required=["raw_text", "sentiment_score", "themes"],
            ),
        )
    },
    required=["reviews"],
)


@dataclass
class BatchSpec:
    idx: int
    film_id: int
    genre: str
    title: str
    region: str
    around_ts: datetime
    around_crisis: bool
    crisis_hint: str | None


def _load_state() -> dict[str, Any]:
    if STATE_PATH.exists():
        return json.loads(STATE_PATH.read_text())
    return {"completed_batches": [], "total_in_tokens": 0, "total_out_tokens": 0}


def _save_state(state: dict[str, Any]) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(state, indent=2))


def _estimated_cost(state: dict[str, Any]) -> float:
    return (state["total_in_tokens"] / 1e6) * PRICE_IN_PER_M + (state["total_out_tokens"] / 1e6) * PRICE_OUT_PER_M


def _load_films() -> list[tuple[int, str, str]]:
    with client() as c:
        return [(int(r[0]), str(r[1]), str(r[2])) for r in
                c.query("SELECT film_id, genre, title FROM films").result_rows]


def _load_crises() -> list[tuple[int, str, datetime, str]]:
    with client() as c:
        return [(int(r[0]), str(r[1]), r[2], str(r[3])) for r in
                c.query("""
                    SELECT affected_film_id, affected_region, injection_timestamp, true_root_cause
                    FROM crisis_ground_truth FINAL
                """).result_rows]


def _plan(films: list[tuple[int, str, str]], crises: list) -> list[BatchSpec]:
    """Build 6000 batch specs: 60% baseline + 40% crisis-clustered."""
    rng = random.Random(2026)
    baseline_n = int(NUM_BATCHES * 0.6)
    crisis_n = NUM_BATCHES - baseline_n
    plan: list[BatchSpec] = []
    now = datetime.utcnow().replace(microsecond=0)

    # Baseline batches
    for i in range(baseline_n):
        fid, genre, title = rng.choice(films)
        region = rng.choice(REGIONS)
        days_back = rng.randint(0, 120)
        ts = now - timedelta(days=days_back, hours=rng.randint(0, 23))
        plan.append(BatchSpec(i, fid, genre, title, region, ts, False, None))

    # Crisis-clustered batches
    if crises:
        for i in range(crisis_n):
            fid, region, cts, cause = crises[i % len(crises)]
            offset_h = rng.randint(-48, 48)
            ts = cts + timedelta(hours=offset_h)
            # Find the film's genre/title
            film = next((f for f in films if f[0] == fid), (fid, "Drama", "Unknown"))
            plan.append(BatchSpec(baseline_n + i, fid, film[1], film[2], region, ts, True, cause))
    else:
        # No crises: fall back to baseline for the remainder
        for i in range(crisis_n):
            fid, genre, title = rng.choice(films)
            region = rng.choice(REGIONS)
            days_back = rng.randint(0, 120)
            ts = now - timedelta(days=days_back, hours=rng.randint(0, 23))
            plan.append(BatchSpec(baseline_n + i, fid, genre, title, region, ts, False, None))

    rng.shuffle(plan)
    for new_idx, spec in enumerate(plan):
        spec.idx = new_idx
    return plan


def _prompt(spec: BatchSpec) -> str:
    base = (
        f"Generate {BATCH_SIZE} realistic viewer reviews for the {spec.genre} film "
        f"\"{spec.title}\" as watched in the {spec.region} region. "
        "Each review 40–120 words, in English. Vary tone: some enthusiastic, some critical, "
        "some mixed. Return sentiment_score in [-1, 1] and 2–4 short themes per review."
    )
    if spec.around_crisis and spec.crisis_hint:
        base += (
            f" Bias the batch toward sentiment reflecting this observed issue: "
            f"\"{spec.crisis_hint}\". Roughly 60% of reviews should reference it directly."
        )
    return base


def _run_batch(cl: "genai.Client", spec: BatchSpec) -> tuple[list[list], int, int]:
    resp = cl.models.generate_content(
        model=os.environ.get("GEMINI_MODEL_FLASH", os.environ.get("GEMINI_MODEL", "gemini-2.5-flash-preview-05-20")),
        contents=_prompt(spec),
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=SCHEMA,
            temperature=0.9,
        ),
    )
    parsed = json.loads(resp.text)
    reviews = parsed.get("reviews", [])
    rows: list[list] = []
    # Deterministic per-batch jitter so retries produce identical (ts, review_id)
    # and Replacing dedupes them.
    jitter_rng = random.Random(spec.idx)
    for row_idx, rev in enumerate(reviews[:BATCH_SIZE]):
        ts = spec.around_ts + timedelta(minutes=jitter_rng.randint(-30, 30))
        review_id = zlib.adler32(f"{spec.idx}:{row_idx}".encode())
        rows.append([
            review_id,
            spec.film_id, spec.region, ts, "gemini_synth",
            str(rev.get("raw_text", ""))[:2000],
            float(rev.get("sentiment_score", 0.0)),
            [str(t)[:64] for t in rev.get("themes", [])[:6]],
        ])
    usage = getattr(resp, "usage_metadata", None)
    in_tok = int(getattr(usage, "prompt_token_count", 0) or 0) if usage else 0
    out_tok = int(getattr(usage, "candidates_token_count", 0) or 0) if usage else 0
    return rows, in_tok, out_tok


def _make_client() -> "genai.Client":
    project = os.environ.get("GOOGLE_CLOUD_PROJECT")
    location = os.environ.get("GOOGLE_CLOUD_LOCATION", "us-east1")
    if not project:
        raise RuntimeError("GOOGLE_CLOUD_PROJECT not set.")
    return genai.Client(vertexai=True, project=project, location=location)


def run(limit: int | None = None) -> None:
    state = _load_state()
    done = set(state["completed_batches"])
    films = _load_films()
    crises = _load_crises()
    plan = _plan(films, crises)

    if os.environ.get("GEMINI_DRYRUN"):
        print(f"DRYRUN: would run {len(plan)} batches; done={len(done)}")
        return

    cl = _make_client()
    ran = 0
    for spec in plan:
        if spec.idx in done:
            continue
        if limit is not None and ran >= limit:
            break
        cost = _estimated_cost(state)
        if cost > COST_CAP_USD:
            print(f"COST CAP hit (${cost:.2f} > ${COST_CAP_USD}); stopping.", file=sys.stderr)
            break
        try:
            rows, in_tok, out_tok = _run_batch(cl, spec)
        except Exception as e:  # noqa: BLE001
            print(f"batch {spec.idx} failed: {e}", file=sys.stderr)
            continue
        if rows:
            insert_batches("reviews_text", rows,
                           column_names=["review_id", "film_id", "region", "ts", "source",
                                         "raw_text", "sentiment_score", "themes"],
                           batch_size=BATCH_SIZE)
        state["completed_batches"].append(spec.idx)
        state["total_in_tokens"] += in_tok
        state["total_out_tokens"] += out_tok
        _save_state(state)
        ran += 1
        if ran % 20 == 0:
            print(f"  batch {ran} done; total done={len(state['completed_batches'])}/{NUM_BATCHES}; cost≈${_estimated_cost(state):.2f}")

    verify()


def verify() -> None:
    with client() as c:
        n = c.query("SELECT count() FROM reviews_text").result_rows[0][0]
    print(f"reviews_text: {n:,} rows (target {TARGET_ROWS:,}).")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--limit", type=int, help="Cap batches this run (for smoke testing)")
    p.add_argument("--verify", action="store_true")
    args = p.parse_args()
    if args.verify:
        verify()
    else:
        run(limit=args.limit)


if __name__ == "__main__":
    main()
