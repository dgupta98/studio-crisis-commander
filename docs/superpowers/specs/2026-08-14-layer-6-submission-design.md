# Layer 6 — Submission & Polish — Design Spec

**Date:** 2026-08-14
**Deadline:** 2026-09-07 14:00 PT (internal: 2026-09-06)
**Enables:** Devpost submission for Agentic Cinema — ClickHouse track.

## Goal

Take Layers 1–5 across the finish line. Produce a **measured** root-cause-accuracy number (N/30) that leads the pitch, deploy both services to Cloud Run scaled-to-zero with a Scheduler warmup, and pass every hackathon compliance gate.

## Scope

**In-scope (this spec covers all of it):**
1. Cloud Run deploy — backend (`scc-api`) + frontend (`scc-frontend`), both scale-to-zero, us-east1. New backend `/health` endpoint. Secrets via Secret Manager. Deploy scripts (`scripts/deploy_backend.sh`, `scripts/deploy_frontend.sh`, `scripts/deploy_all.sh`).
2. Cloud Scheduler warmup — `scc-warmup` job hitting `/health` every 4 minutes.
3. **Eval harness (hybrid)** — 30 scenarios covering all 8 crisis types; `scripts/eval_live.py` for the headline number, `scripts/eval_replay.py` for reproducible CI. Cached triples in `data/eval_cache/`. Latest run artifact in `data/eval_runs/latest.json`.
4. Letterbox frame on `HeroBanner` — the one visual polish item kept for the video.
5. `scripts/smoke.sh` — cold-clone runner.
6. Backend Dockerfile local smoke (deferred from L4 Task 14).
7. L5 acceptance §5 live sweep (deferred from L5 Task 22).
8. Cached fallback-triple live regen (deferred from L3).
9. `scripts/compliance_audit.sh` — Stage-1 forbidden-library grep.
10. TMDB attribution in README and Devpost.
11. 3-minute voice-over walkthrough video, YouTube unlisted → public at submission.
12. Devpost writeup drafted at `docs/devpost_writeup.md`.
13. Preflight script `scripts/preflight.sh` — 9-gate submission gate.
14. Submission ceremony documented in README.

**Non-goals / explicitly cut:**
- Multimodal trailer analysis (chose the eval-harness differentiator instead).
- Film grain overlay, detection chime, additional viewports beyond 1080p.
- New pytest smoke tests; SSE golden-snapshot tests. The eval harness's 30-scenario live run is the end-to-end signal.
- `min-instances=1` on either Cloud Run service (Scheduler warmup covers cold-start).

## Calendar

Today = 2026-08-14. Hard deadline 2026-09-07 14:00 PT. Internal gate 2026-09-06.

| Days | Focus |
|---|---|
| Aug 14–16 | Cloud Run deploy scripts + `/health` + Scheduler warmup + `smoke.sh` + `compliance_audit.sh`. |
| Aug 17–22 | Eval harness (live + replay tracks). Letterbox polish. L4 Docker smoke + L5 §5 live sweep. Cached fallback triple regen. |
| Aug 23–25 | First full live eval run. README + Devpost draft. TMDB credit. **ClickHouse credit card added.** |
| **Aug 31** | **Hard external — $100 credit form submitted.** |
| Aug 26–30 | Video recording + edit. Devpost polish. Dry-run cold-clone from a scratch machine. |
| Sep 1–5 | Buffer — re-record video, tweak Devpost, or slip earlier tasks. |
| **Sep 6** | **Internal gate.** Run `scripts/preflight.sh`. Final live eval → bake N/30 into README. Submit. |
| Sep 7 14:00 PT | Hard deadline. Buffer already spent. |

## Architecture — Cloud Run + Warmup

Two Cloud Run services, us-east1 (matches ClickHouse Cloud region):

| Service | Container | CPU / Mem | Min / Max | Concurrency | Timeout |
|---|---|---|---|---|---|
| `scc-api` | `backend/Dockerfile` (existing) | 1 / 1 GiB | 0 / 5 | 20 (SSE-friendly) | 300 s |
| `scc-frontend` | `frontend/Dockerfile` (existing) | 0.5 / 256 MiB | 0 / 3 | 80 | 60 s |

**Backend `/health` endpoint** — trivial `GET /health → {"status": "ok"}`, no ClickHouse or Gemini calls. Warmup stays cheap; endpoint stays green even when downstream deps flake.

**Secrets** — via Secret Manager. Backend service account gets `roles/secretmanager.secretAccessor`. Mounted on `scc-api` via `--set-secrets`:
- `gemini-api-key` → `GEMINI_API_KEY`
- `clickhouse-url` → `CLICKHOUSE_URL`
- `clickhouse-user` → `CLICKHOUSE_USER`
- `clickhouse-password` → `CLICKHOUSE_PASSWORD`
- `mcp-clickhouse-url` → `MCP_CLICKHOUSE_URL`

**Cloud Scheduler warmup:**
- Job name: `scc-warmup`, region us-east1.
- Schedule: `*/4 * * * *` (every 4 min).
- Target: HTTP GET `https://scc-api-<hash>.a.run.app/health`.
- Retry: default; a missed ping just means the next fires 4 min later.
- Free tier: 3 jobs/mo included; we use 1.

**Deploy scripts:**
- `scripts/deploy_backend.sh` — `gcloud builds submit` + `gcloud run deploy scc-api ...`; echoes the deployed URL.
- `scripts/deploy_frontend.sh <BACKEND_URL>` — two-step: `docker build --build-arg VITE_API_URL=<BACKEND_URL>` + `docker push` + `gcloud run deploy scc-frontend --image ...` (the corrected pattern from L5 Task 24 fix commit).
- `scripts/deploy_all.sh` — deploys backend → captures URL → deploys frontend → creates/updates Scheduler. Idempotent.

**Cost accounting (14-day judging window Sep 23 – Oct 7):**
- Cloud Run: ~$2–5 (warm pings + judge traffic bursts).
- Cloud Scheduler: free (1 job, well under the 3-job free tier).
- Secret Manager: 5 secrets × $0.06/mo ≈ $0.30.
- **Total <$10** on top of the $300 GCP credit.

**Rollback** (documented in README): if warmup misbehaves during judging, `gcloud scheduler jobs pause scc-warmup` + `gcloud run services update scc-api --min-instances=1`. Costs ~$40 extra but guarantees green through Oct 7.

## Architecture — Eval Harness (hybrid)

**Purpose:** produce the "correctly identified primary root cause in **N/30**" number that leads the video, README, and Devpost writeup.

**Two tracks sharing the same scoring logic:**
- **Live** (`scripts/eval_live.py`) — inject each scenario into the running backend, subscribe to SSE, capture `decision.primary_cause`, score.
- **Replay** (`scripts/eval_replay.py`) — load cached triples from `data/eval_cache/`, extract `decision.primary_cause`, score. Zero network.

**File layout:**
- `backend/eval/scenarios.json` — 30-scenario definition, checked in. Each entry: `{id, crisis_type, film_id, region, expected_primary_cause}`. `expected_primary_cause` pulled at author time from `crisis_ground_truth.true_root_cause`.
- `backend/eval/runner.py` — shared: load scenarios, score, write results.
- `backend/eval/live.py` — live orchestration; reuses `PipelineRuntime`. Records triples to `data/eval_cache/{scenario_id}.json` when invoked with `--record`.
- `backend/eval/replay.py` — cached replay; hard-fails on missing cache file with the scenario id in the error.
- `scripts/eval_live.py` — thin CLI shim.
- `scripts/eval_replay.py` — thin CLI shim.
- `data/eval_cache/*.json` — 30 committed triples in the existing L3 fallback-triple shape (`{investigation, decision, report}`).
- `data/eval_runs/*.json` — per-run output artifacts (gitignored except `latest.json`).
- `data/eval_runs/latest.json` — final live-run artifact, checked in so the number in README is git-traceable.
- `backend/eval/tests/test_scoring.py` — unit test on the compare function.
- `backend/eval/tests/test_replay.py` — 3-scenario integration test in replay mode.

**Scoring rule:** exact string match — `decision.primary_cause == scenario.expected_primary_cause`. No fuzzy matching; the whole point of ground truth is the answer is unambiguous.

**Scenario distribution** — 8 crisis types, weighted toward the ambiguous ones. Total 30 = 6 × 4 + 2 × 3:
- 4 each (6 types): `regional_sentiment_collapse`, `negative_social_virality`, `refund_spike`, `competitor_release_impact`, `trailer_variant_underperformance`, `marketing_overspend_low_roi` = 24.
- 3 each (2 types): `streaming_completion_drop`, `review_score_divergence` = 6.
- Total: 30. Ambiguous types (competitor, refund) get the deeper coverage; the two easier detection types get 3.

**Result shape (both modes):**
```json
{
  "run_id": "eval_2026-09-06T19:14:03Z",
  "mode": "live",
  "total": 30,
  "correct": 27,
  "errored": 1,
  "accuracy": 0.9,
  "per_type": {"regional_sentiment_collapse": {"n": 4, "correct": 4}, "...": "..."},
  "scenarios": [
    {"id": "sc_001", "expected": "sentiment_collapse", "actual": "sentiment_collapse",
     "matched": true, "latency_ms": 14200},
    "..."
  ]
}
```

**Error handling (live):** per-scenario pipeline failure → one retry with backoff → if still failing, mark `errored: true`. Errored scenarios are reported separately, **not** counted as wrong. Headline reads "27/30 correct, 1 errored, 2 wrong" or collapses to "27/30" if `errored == 0`.

**Error handling (replay):** never touches the network. A missing cache file is a hard failure, with the scenario id in the error.

**README + Devpost integration:** the number in `data/eval_runs/latest.json` gets baked into README `## Accuracy` and Devpost writeup at submission time from the final Sep 6 live run. Manual copy-paste — one-shot, not worth automating.

## Submission Mechanics

**Video (3 min voice-over, 1080p MP4):**
- Recording: OBS Studio or QuickTime.
- Editing: iMovie (or Descript for transcript-based cuts).
- 6 beats, ~30 s each:
  1. Cold-open — ops center idle. "Studio Crisis Commander detects box-office anomalies in real time and recommends action, backed by 50 million rows of telemetry."
  2. Click Inject → `regional_sentiment_collapse`. "The Detection layer runs pure SQL against ClickHouse — no LLM in the hot path."
  3. AgentTrace fills. "The Investigation agent runs eight grounded queries via mcp-clickhouse."
  4. Recommendation panel + Key Figures. "Each recommendation cites the exact ClickHouse query that produced it."
  5. Approve. "Human-in-the-loop is enforced by policy — actions above the threshold gate on approval."
  6. **Money shot** — cut to `latest.json` on screen with overlay: **"27/30 correctly identified primary root cause."** "Measured accuracy — a real number, not a claim."
- YouTube unlisted → public at submission. Captions auto-gen + hand-corrected.
- No third-party logos (rule 7C). Hackathon badge + our repo URL only.

**Devpost writeup — mapped to the 4 judging criteria:**

| Devpost section | Maps to | Length |
|---|---|---|
| Inspiration | Impact + Idea | ~100 w |
| What it does | Idea | ~150 w |
| How we built it | **Tech Implementation** | ~200 w |
| Challenges | Tech + Idea | ~100 w |
| Accomplishments | Tech (measured 27/30) + Design | ~150 w |
| What we learned | Idea | ~100 w |
| What's next | Impact | ~100 w |
| Built with | Tech (list) | tags |
| Try it out | Cloud Run URL | link |
| GitHub | link | link |

Drafted in `docs/devpost_writeup.md`, checked in so the number in "Accomplishments" is git-blame traceable.

**Stage-1 compliance audit — `scripts/compliance_audit.sh`:**
```bash
#!/usr/bin/env bash
set -euo pipefail

FORBIDDEN_PY=(openai anthropic cohere mistralai llama langchain llamaindex autogen crewai)
for lib in "${FORBIDDEN_PY[@]}"; do
  grep -iE "^${lib}([[:space:]<>=~!]|$)" backend/requirements.txt \
    && { echo "FAIL: forbidden Python lib $lib"; exit 1; } || true
done

FORBIDDEN_JS=(openai @anthropic-ai cohere @mistralai langchain llamaindex)
for lib in "${FORBIDDEN_JS[@]}"; do
  grep -iE "\"${lib}[^\"]*\":" frontend/package.json \
    && { echo "FAIL: forbidden JS lib $lib"; exit 1; } || true
done

grep -qE "^(google-adk|google-genai|google-generativeai|google-cloud-aiplatform)" \
  backend/requirements.txt || { echo "FAIL: no Google AI lib"; exit 1; }
grep -qE "^mcp-clickhouse" backend/requirements.txt \
  || { echo "FAIL: mcp-clickhouse missing"; exit 1; }

echo "=== Stage-1 audit PASSED ==="
```

**Cold-clone smoke — `scripts/smoke.sh`:**
- Docker-builds backend and frontend from a fresh clone.
- Starts both containers with a minimal `.env` (README documents the shape).
- Polls `/health` for up to 30 s.
- cURLs `/detections`, greps for a valid JSON array.
- Cleans up containers on exit via `trap`.
- Exits 0 on success; non-zero and prints the failing step otherwise.

**TMDB attribution:**
- `README.md` gets `## Credits`: "This product uses the TMDB API but is not endorsed or certified by TMDB." + logo attribution per TMDB terms.
- Devpost "Built with" section includes the same block.

## Acceptance — Preflight Gates

**`scripts/preflight.sh`** — one command; pretty-prints a green/red grid. Every row must be green before submission on Sep 6.

| # | Gate | Command | Green condition |
|---|---|---|---|
| 1 | Live backend | `curl -sf $BACKEND_URL/health` | `200 OK`, `{"status":"ok"}` |
| 2 | Live frontend | `curl -sf $FRONTEND_URL/` | `200 OK`, HTML contains brand marker |
| 3 | Live sustained | 1-hour poll loop (background, run once earlier) | Zero errors over 60 min |
| 4 | Eval ran | `test -f data/eval_runs/latest.json` | file exists, JSON parses |
| 5 | Eval floor | `jq -e '.accuracy >= 0.7' data/eval_runs/latest.json` | exit 0 (true) |
| 6 | Replay parity | `python scripts/eval_replay.py` vs live | within ±1/30 |
| 7 | Compliance | `bash scripts/compliance_audit.sh` | exit 0 |
| 8 | Cold-clone | `git clone . /tmp/scc-fresh && bash /tmp/scc-fresh/scripts/smoke.sh` | exit 0 |
| 9 | Repo hygiene | `git ls-files \| grep -E '\.env$\|service-account\.json'` | empty |

**Non-preflight manual gates (checklist in README):**
- Video ≤ 180 s, audio audible, no third-party logos, uploaded YouTube unlisted.
- Devpost project created, ClickHouse track selected, all 4 media slots filled, "Try it out" and "GitHub" links live.
- GitHub repo public, MIT LICENSE at root + About-section badge.
- $100 credit form submitted (**deadline Aug 31**).
- ClickHouse Cloud credit card added.
- README `## Accuracy` has final N/30 pasted from `data/eval_runs/latest.json`.

**No new pytest smoke, no SSE snapshot tests.** The eval harness's 30-scenario run is the end-to-end signal.

## Submission Ceremony (Sep 6)

1. `bash scripts/preflight.sh` → all 9 gates green. If any red, fix and re-run.
2. Final live eval → copy N/30 from `latest.json` into README `## Accuracy`. Commit as `docs: bake final eval accuracy N/30`.
3. Flip YouTube video from unlisted → public.
4. Submit on Devpost with locked-in ClickHouse track.
5. `git tag v1.0-submitted && git push --tags`.
6. Screenshot Devpost confirmation, save to `docs/submission_confirmation.png`.

## Testing Strategy

Reuse existing coverage (from L1–L5). Add:
- `backend/eval/tests/test_scoring.py` — pure unit test on the compare function.
- `backend/eval/tests/test_replay.py` — integration test on a 3-scenario replay subset (fast, deterministic, no network).

Everything else is verified by the preflight gates and the eval harness itself.

## Boundaries and File Ownership

- **Deploy scripts** live in `scripts/`, not inside `backend/` or `frontend/`. They cross package boundaries — that's their whole job.
- **`/health` endpoint** lives in `backend/api/main.py` next to the other simple endpoints, not in a new module. One-liner doesn't warrant its own file.
- **Eval harness** lives in `backend/eval/` — a new package parallel to `backend/agents/` and `backend/api/`. It's not an agent, not an API, not data-layer code.
- **CLI shims** (`scripts/eval_live.py`, `scripts/eval_replay.py`) do argument parsing only; all logic lives in `backend/eval/`.
- **Devpost writeup and preflight docs** live in `docs/`, not root.

## Non-Functional Requirements

- Cloud Run cost during judging: <$10 on top of GCP credit.
- Preflight script total wall time: <5 min (excluding the 1-hour sustained-uptime gate).
- Cold-clone smoke total wall time: <5 min from `git clone` to green.
- Video: 1080p, ≤ 180 s, MP4, audio track present.
