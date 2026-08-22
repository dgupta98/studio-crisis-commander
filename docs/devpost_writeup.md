# Devpost Writeup — Studio Crisis Commander

_Draft target: 900–1,000 words across all sections. Update `N/30` and Cloud Run URLs before submission (Sep 6)._

## Inspiration

Studios sit on colossal telemetry — box-office, streaming, social, refunds, campaigns — but when a crisis hits (a bad opening weekend, a viral trailer flop, a refund spike), the human answer is still to fire off Slack pings and pull together a war room by hand. We wanted to show that an agentic system can watch every signal, detect the anomaly, investigate its root cause with grounded queries, and hand a shortlist of ranked actions to a human — in under three minutes end-to-end.

## What it does

Studio Crisis Commander is a four-agent editorial ops center presented through a cinematic multi-route product surface (Landing / Dashboard / Movies / Movie Detail):

1. **Detection** runs pure SQL against ClickHouse — rolling z-scores against baselines, no LLM in the hot path. Latency: milliseconds, surfaced as a `LatencyBadge` on every anomaly card.
2. **Investigation** dispatches four grounded sub-agents (numeric context, text reason, categorical isolation, temporal context), each of which runs one query via the ClickHouse MCP server and cites the exact rows behind its narrative.
3. **Decision** synthesizes the findings into 1–3 ranked actions with `impact_usd` estimates — each with an `impact_sql` field that carries the query that produced the number. LLM narrates, SQL computes.
4. **Report** produces a human-readable executive summary with the numbers linked back to their source queries.

A human approves or denies before anything crossing the impact threshold ships. Featured films replay from `data/eval_cache/*.json` for judge-friendly cold-open playback; the long tail runs the full live pipeline on demand.

## How we built it

- **Runtime AI:** Gemini via `google-genai` and `google-cloud-aiplatform`; Google ADK for agent orchestration. Zero third-party AI libraries.
- **Data plane:** ClickHouse Cloud, 50M+ rows of synthetic telemetry seeded from the TMDB catalog. All agent access via the `mcp-clickhouse` MCP server (direct clients used only in the Layer 1 build pipeline).
- **API:** FastAPI + SSE for the live pipeline stream (`GET /stream/investigation/{run_id}`), plus `/intake/rates` SSE, `/stats/summary`, `/catalog/shelves`, `/catalog/films/{id}`, and a static `eval_cache` mount for cached triples. Cached-triple fallback ensures the demo always renders even if a downstream flakes.
- **Frontend:** React 18 + Vite + TypeScript + Tailwind + Framer Motion + Zustand + React Router 6 + React Query. Six routes: Landing (particle cascade, live counters, 4-agent fold, CTAs), Dashboard (intake strip, anomaly feed, investigation/recommendation/approval tabs, persistent Agent Trace, telemetry), Movies (Netflix-style shelves + featured hero rotator), Movie Detail (hero + latest investigation + persistent trace + past runs + ambient telemetry), Audit, Settings. Signal-family color tokens (blue/pink/yellow/green) become first-class primitives (`SignalChip`, `LatencyBadge`). Boundary-tested — panels never touch the network directly; the store owns the SSE lifecycle.
- **Eval:** 30-scenario harness spanning all 8 crisis types. **N/30 correctly identified primary root cause** as of the Sep 6 live run. `./scripts/eval_replay.py` reproduces this deterministically from cached triples.
- **Quality gates:** Lighthouse ≥ 96 Performance, 100 Accessibility, 96 Best Practices across all 4 core routes. Axe a11y sweep gates the CI e2e suite with zero serious/critical violations. Reduced-motion mode disables the particle cascade for vestibular safety.
- **Deploy:** Two Cloud Run services (backend + frontend), scale-to-zero, us-east1 (same region as ClickHouse Cloud). Cloud Scheduler pings `/health` every 4 min to keep judging cold-starts off the demo.

## Challenges we ran into

- **Editorial pacing over technical pacing.** Our first cut felt like a dashboard. Making it feel like a live newsroom took eight passes on Framer Motion choreography, a per-signal-family color language, and a full second draft of the product surface — the L7 cinematic revamp that split the single-page ops-center into a Landing → Dashboard → Movies → Movie Detail route graph.
- **Grounding without hallucination.** The Investigation Agent's sub-agents must only narrate numbers that appear in their own query results. We enforced that at the Pydantic contract layer (`SignalFinding.rows` is required; the LLM prompt uses it as the exclusive source).
- **Cold-start latency on Cloud Run.** Scale-to-zero saves ~$40/mo but adds ~4s of cold-start on judge access. Cloud Scheduler warmup at `*/4 * * * *` cuts this to near-zero for judging traffic at the cost of one free-tier job.

## Accomplishments we're proud of

- **A measured accuracy number.** Most hackathon projects claim "high accuracy" with no receipts. We shipped an eval harness that runs 30 scenarios end-to-end and reports N/30 with per-type breakdown. The artifact is at `data/eval_runs/latest.json` and reproducible via `./scripts/eval_replay.py`.
- **Provenance at the type level.** Every dollar figure in a `RecommendedAction` has a non-empty `impact_sql`. The Pydantic `model_validator` refuses to construct an action with an impact_usd but no supporting SQL. LLM narrates, SQL computes — enforced.
- **Cinematic product surface.** Four routes, a landing page with a canvas-based per-family particle cascade, a persistent Agent Trace that follows you across screens, cached investigation playback for featured films, and Lighthouse ≥ 96 Performance / 100 Accessibility across all core routes.

## What we learned

- **The MCP server is a load-bearing abstraction.** Every agent's ClickHouse access flows through `mcp-clickhouse`. This kept the agents thin and made the "no direct DB from agents" rule enforceable via a boundary-grep test.
- **Cached-triple fallback is not a demo hack — it's an SLO tool.** The Layer 4 fallback replays a real pre-recorded pipeline run when live paths fail. It costs $0.10 to regenerate and buys 100% demo uptime.
- **Eval harnesses beat "vibes."** Once we could measure, we could iterate — every prompt or contract change gets a `eval_replay` run before merge.

## What's next

- Multimodal trailer analysis — feed trailer variants directly to Gemini's video understanding and let it hypothesize which visual moments correlate with drop-off.
- Auto-executed actions for the two lowest-impact types with a rollback timer.
- Extending the eval harness with adversarial scenarios where the true root cause is a compound of two crisis types.

## Built with

Paste the following into Devpost's Built With field (comma-separated, 24 tags, under the 25 cap):

Python, FastAPI, uvicorn, Pydantic, Vite, React, TypeScript, Tailwind, Framer Motion, Zustand, Recharts, Gemini, google-genai, google-cloud-aiplatform, Google ADK, ClickHouse, mcp-clickhouse, Cloud Run, Cloud Scheduler, Secret Manager, GCP, Playwright, Vitest, pytest

## Try it out

- Live: [scc-frontend](https://scc-frontend-845114229642.us-east1.run.app) (Cloud Run)
- Repo: https://github.com/dgupta98/studio-crisis-commander
- Video: https://youtu.be/<id>
