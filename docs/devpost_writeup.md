# Studio Crisis Commander

> _An agentic newsroom for the 2 a.m. crisis DM._
> Movie-first. Region-aware. Every dollar figure traceable to the SQL that produced it.

**Live:** [scc-frontend.us-east1.run.app](https://scc-frontend-845114229642.us-east1.run.app) · **Code:** [github.com/dgupta98/studio-crisis-commander](https://github.com/dgupta98/studio-crisis-commander) · **Video:** _(link before submit)_

---

## 🎬 Inspiration

Every major studio has the same 2 a.m. Slack DM. Refunds jumped in Germany. A trailer variant just launched. Sentiment on `X` is bleeding for one film in one market. And somebody, somewhere, has to decide whether to pull the trailer *right now* or wait for the war room to wake up.

The data to answer that question exists. It's sitting in a warehouse, sliced across 250 films × 15 regions × 120 days — roughly **50 million numeric rows and 150 thousand text rows** of box office, streaming, refunds, reviews, and social. The problem isn't observability. The problem is that turning telemetry into a defensible recommendation is a *human coordination* task — five Slack threads, three notebooks, and a VP.

We wanted to prove that an agentic system can do the coordination *and* keep the receipts. Not "an LLM guesses a plan," but a four-agent pipeline where **every claim points at the exact SQL row that justifies it**, every dollar figure carries the query that produced it, and a human still holds the gate on anything material.

---

## 🧠 What it does

Studio Crisis Commander is a **movie-first, multi-region ops center** for editorial and marketing teams. The product surface has three primary routes — **Dashboard**, **Movies**, and **Movie Detail** — plus a Landing page and a persistent Agent Trace drawer that follows you across screens.

The core loop is a four-agent pipeline:

| # | Agent            | What it does                                                                                                | Model / Tech                     |
|---|------------------|-------------------------------------------------------------------------------------------------------------|----------------------------------|
| 1 | **Detection**    | Rolling z-scores against per-film baselines. **Pure SQL — no LLM in the hot path.**                          | ClickHouse, milliseconds         |
| 2 | **Investigation** | Fans out to four grounded sub-agents (numeric / text / categorical / temporal), each running one MCP query. | Gemini 2.5 Flash + Pro via ADK   |
| 3 | **Decision**     | Synthesizes findings into 1–3 ranked actions, each with an `impact_usd` and an `impact_sql`.                | Gemini 2.5 Pro                   |
| 4 | **Report**       | Executive summary; every headline number carries a `source_query` popover.                                  | Gemini 2.5 Flash                 |

Anything above the impact threshold waits at an approval gate. Auto-executed decisions carry a rollback timer. Every step lands in an append-only audit table.

### The flow, end-to-end

The dashboard is now built around the **film** as the primary object, not the anomaly feed:

1. **Land on Dashboard** → pick a movie from the `FilmPicker`.
2. The **RegionHeatBar** blooms — 15 markets, colored by signal family, showing where the film is actually bleeding.
3. Pick a region → the workspace scopes: `TimeseriesGrid` shows 4-up sparklines for box office / social / streaming / reviews, `DashboardWorkspace` swaps to that region's latest investigation.
4. Hit **Inject Crisis** → pick one region *or many*. The backend fans out N parallel pipelines. The bottom-docked `PipelineTicker` grows one pill per run, each with its own detection→investigation→decision→report progress dots. Click any pill to focus that run's trace.
5. On **Movie Detail**, past runs are clickable — the whole workspace time-travels into that historical run's detection, decision, and report.

The whole surface stays in sync via a single Zustand store with per-run event buckets. Mirror-on-focus keeps existing panels reading from top-level singletons; a `useScopeMatches()` hook blanks any panel whose loaded data doesn't belong to the currently-selected `film × region`.

---

## 📊 How we built it

### Data plane

**ClickHouse Cloud**, us-east1. One Layer-1 build pipeline seeds the warehouse from the TMDB catalog (Kaggle bulk + live API) and expands it with a deterministic synthetic generator: **~50 M numeric rows**, **~150 K text rows** (real reviews + Gemini-authored longform), and a crisis injector that records ground truth for the eval harness. Direct `clickhouse-connect` clients live *only* in the build pipeline and the Layer-2 materialized-view setup.

Every **agent** ClickHouse call flows through the **`mcp-clickhouse` MCP server** — enforced by a boundary-grep test in CI. The `MCPToolset` is pooled across the four sub-agents so one stdio subprocess handles all four in-flight queries, saving ~15s of cold-start on Cloud Run.

### Runtime AI

- **Gemini 2.5 Flash / Pro** via `google-genai` and `google-cloud-aiplatform`
- **Google ADK** for `SequentialAgent` orchestration and MCP toolset lifecycle
- **Zero third-party AI libraries** — no LangChain, no LlamaIndex, no CrewAI, no third-party LLMs

### API

FastAPI + Server-Sent Events. The interesting endpoints:

```
POST /inject-crisis                     ← accepts region OR regions[] (multi-region fan-out)
GET  /stream/investigation/{run_id}     ← SSE, one connection per run
GET  /catalog/films/{id}                ← film metadata + top_regions with 7d deltas
GET  /catalog/films/{id}/runs           ← past-runs list
GET  /catalog/films/{id}/runs/{did}     ← full audit triple for a decision (time-travel)
GET  /films/{id}/latest-investigation?region=REGION
GET  /metrics/{film_id}/regions         ← 15-region telemetry rollup for the heat bar
```

The runtime keeps a **background ClickHouse warmer** (`SELECT 1` every 4 min) so the compute pool never auto-suspends between demos, and a **cached-triple fallback** so a downstream flake replays a real, pre-recorded pipeline run instead of erroring out.

### Frontend

React 18 + Vite + TypeScript + Tailwind + Framer Motion + Zustand + React Query. The store owns the SSE lifecycle — panels never touch the network directly. A per-run event bucket lets multi-region injects display N independent traces without any run stomping on another.

### Deploy

Two Cloud Run services (backend + frontend), `min-instances=1` on the API so telemetry never cold-starts. Cloud Build auto-deploys on push to `main` from `backend/**` and `frontend/**` paths.

---

## 📈 Accuracy — with receipts

Most hackathon projects claim "high accuracy" with no receipts. We ship an eval harness that runs 30 scenarios end-to-end and reports a per-type breakdown. The artifact lives at [`data/eval_runs/replay-latest.json`](https://github.com/dgupta98/studio-crisis-commander/blob/main/data/eval_runs/replay-latest.json) and reproduces via `./scripts/eval_replay.py`.

**Current: 21 / 30 = 70% primary-cause accuracy** across 8 crisis types.

| Crisis type                          |  N  | Correct | Accuracy |
|--------------------------------------|:---:|:-------:|:--------:|
| refund_spike                         |  4  |   4     | **100%** |
| trailer_variant_underperformance     |  4  |   4     | **100%** |
| marketing_overspend_low_roi          |  4  |   4     | **100%** |
| streaming_completion_drop            |  3  |   3     | **100%** |
| negative_social_virality             |  4  |   2     |  50%     |
| competitor_release_impact            |  4  |   2     |  50%     |
| regional_sentiment_collapse          |  4  |   1     |  25%     |
| review_score_divergence              |  3  |   1     |  33%     |

The failure modes are almost entirely *narrative* — the agent finds the right *signal* but attributes it to a plausible-adjacent cause (e.g. "regional_sentiment_collapse" gets read as "negative_social_virality" because the driving platform *is* Twitter, just downstream of the actual sentiment collapse). Those are contract-shape problems we can fix; we chose to submit with the honest number rather than tune to it.

---

## 🚧 What broke, and what we learned

### The bugs we're still a little bitter about

**The single `_closeStream` ref that killed every multi-region demo.**
Our first multi-region cut kept overwriting one `close()` handle on every `connectStream()`. So spawning 3 parallel runs left exactly *one* alive — the last one. Symptoms: pipeline pills that stared at you with all-hollow dots forever. Fix was a per-runId `Record<string, () => void>` closer map. Two-line diff, four hours of debugging.

**Zustand persist keeping zombie runs alive across sessions.**
Runs from before that fix landed had `streamState: 'streaming'` frozen in localStorage. Every reload restored them into the ticker. Fixed by (a) bumping `persist` version to invalidate old payloads, (b) removing `activeRuns` from the persisted partial entirely — SSE can't be resumed anyway — and (c) a 3-minute stale filter as a runtime guard.

**Cloud Run's dependency roulette.**
We shipped `google-cloud-aiplatform[adk]>=1.101.0`. Cloud Build resolved the latest ADK on rebuild, and a newer version moved `StdioConnectionParams` under a different path. Container exit(1)'d before it could bind :8080. Pinned every direct dep to the versions the local venv actually runs. Bump deliberately from now on.

### The design decisions that survived

- **Pooled MCP toolset over per-agent subprocesses.** Sharing one `mcp-clickhouse` stdio subprocess across the four sub-agents cut cold-start by ~15s. Safe because the `SequentialAgent` never overlaps two tool calls on the same stdio pipe.
- **Movie-first over anomaly-first.** The old design led with the anomaly feed. Users had no anchor — they'd see "trailer variant regression in DE" and ask *which movie?* Leading with the film + heat bar reframes the question and makes multi-region a first-class idea.
- **Cached-triple fallback as an SLO tool, not a demo hack.** Regenerating a triple costs $0.10. The bundled 30 buy us 100% demo uptime independent of ClickHouse's mood.

---

## ✨ What's next

- **A single movie-intelligence hub across every source.** The `/what-next` tab in the app already maps out the direction: fold in **YouTube, Instagram, TikTok, X, IMDb, Wikipedia, blogs, news portals, and OTT platforms** as first-class investigation signals alongside ClickHouse telemetry. Same four-agent pipeline, wider surface area — trailers and reels for creative diagnosis, editorial + Wikipedia for context, IMDb + OTT for release/availability, cross-source sentiment for the audience-vs-critic split. Regional + language filtering, real-time updates, and a fake-news / duplicate filter round it out. The point isn't more dashboards — it's giving the agents *more places to look* before they cite a claim.
- **Multimodal trailer analysis.** Feed trailer variants directly to Gemini's video understanding and let it hypothesize which visual moments correlate with drop-off. Pairs naturally with the trailer-and-teaser source above.
- **Auto-executed actions with a rollback timer** for the two lowest-impact types.
- **Adversarial eval scenarios** where the true root cause is a *compound* of two crisis types — the class that dropped us from 30/30 to 21/30.

---

## 🛠 Built with

`Python` · `FastAPI` · `uvicorn` · `Pydantic` · `Vite` · `React` · `TypeScript` · `Tailwind` · `Framer Motion` · `Zustand` · `Recharts` · `Gemini 2.5` · `google-genai` · `google-cloud-aiplatform` · `Google ADK` · `ClickHouse` · `mcp-clickhouse` · `Cloud Run` · `Cloud Scheduler` · `Secret Manager` · `GCP` · `Playwright` · `Vitest` · `pytest`

---

> **The pitch, in one sentence:**
> Watch every signal, cite every claim, ship every recommendation — before the meeting starts.
