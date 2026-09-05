# Studio Crisis Commander — Build Architecture Report

> Full 6-layer design. Autonomous AI Operations Center for Entertainment Studios.
> Agentic Cinema: The Blockbuster Hackathon · ClickHouse Track.

| | |
|---|---|
| Prepared for | Dipesh Gupta |
| Scope | Complete layer-by-layer build design (Layers 1–6) |
| Status | All 6 layers resolved and locked |
| Submission deadline | September 7, 2026 @ 2:00 PM PT (internal: Sep 6) |
| Judging window | September 23 – October 7, 2026 |
| Prize (ClickHouse) | 1st $7,500 · 2nd $3,000 · 3rd $2,000 |

**How to use this document:** Every design decision reached across the six build layers, in dependency order (bottom-up: data first, UI last). Each layer lists what was resolved and the reasoning. Paste the relevant layer into a build session when you start coding it.

---

## 1. Architecture Overview

Studio Crisis Commander is a network of Gemini-powered autonomous agents that continuously monitors entertainment telemetry in ClickHouse, detects anomalies the moment they emerge, investigates root causes across numeric, text, categorical, and temporal signals, and recommends data-grounded recovery strategies — all within minutes. Built in six layers, each depending on the one below it.

| Layer | What it is | Why it comes in this order |
|---|---|---|
| 1 · Data | TMDB-seeded 50–65M row telemetry + 150K text + crisis injector | Nothing works without data in ClickHouse |
| 2 · Detection | Pure SQL anomaly detection (z-score, EWMA, %-change) | Needs data to detect against |
| 3 · Agents | mcp-clickhouse + Investigation/Decision/Report on ADK | Needs detections to investigate |
| 4 · Orchestration | FastAPI on Cloud Run, SSE live agent trace | Needs agents to orchestrate |
| 5 · UI | Cinematic-modern ops dashboard | Needs the API to render real data |
| 6 · Submission | Deploy, video, writeup, eval, compliance | Needs the product finished |

> **Guiding principle:** One flawless crisis flow, fully polished, beats ten half-working panels. Every layer serves a single end-to-end story: inject a crisis → detect it → investigate it → recommend a fix → approve it. If time compresses, cut breadth, never the polish of that one flow.

---

## 2. LAYER 1 — Data Foundation ✓ RESOLVED

The layer that grounds everything. Real public data provides the anchors; a generator expands them into realistic time-series telemetry at ClickHouse scale. Fake data that follows real distributions is what makes the demo credible — pure random noise is what makes judges suspicious.

### Real grounding — two sources

- **Catalog:** TMDB Box Office dataset (Kaggle): ~7,000–10,000 real movies with actual budgets, revenue, genres, release dates, runtimes, languages. This is the seed catalog.
- **Live signals:** TMDB REST API (live, free for non-commercial): real popularity scores, vote averages, and review text per movie. These anchor the synthetic curves.
- **Compliance:** TMDB must be credited in README and Devpost (their terms). This is a data source, not an AI tool — it does NOT count against the Google-only AI restriction.

### Scale and shape (locked)

| | |
|---|---|
| Movies | 250 (from real TMDB catalog) |
| Regions | 15 (NA, LATAM, UK, EU-West, EU-East, Nordics, India, SEA, Korea, Japan, China, MENA, Africa, ANZ, Brazil) |
| Window | 120 days (pre-release hype → post-release tail) |
| Granularity | Hourly for streaming/sentiment; daily for box office/spend (matches reality) |
| Numeric rows | ~50–65M (the "why ClickHouse" scale story) |
| Text rows | 150K, real + Gemini-generated, dense around crisis windows, persisted |

### The four signal families

Numeric tells you WHAT moved, text tells you WHY, categorical tells you WHERE, temporal tells you WHEN. They only become intelligence when they share join keys — every table joins on `film_id + region + time_bucket`. A crisis that lives in one signal type looks scripted; the crises that impress judges are cross-signal (a number drops in table A, the reason is in the text of table B, isolated to one value in categorical table C).

| Family | Examples | Role |
|---|---|---|
| Numeric | box office, watch minutes, spend, refunds, completion | the WHAT — Detection runs SQL over this |
| Text | reviews, social posts + computed sentiment score | the WHY — Investigation reads this |
| Categorical | genre, region, trailer variant, channel, competitor | the WHERE — isolates the crisis |
| Temporal | release timing, holidays, competitor calendar, weather | the WHEN — explains timing |

> **The two-layer text pattern:** Each text row stores BOTH the raw text AND a computed numeric sentiment score. Detection fires on the fast numeric score (SQL). Investigation reads the actual text via mcp-clickhouse to explain why. Gemini generates the synthetic review text (a legitimate Google-AI build-time use); a non-Google model here would be a disqualifier.

### Crisis injector + live streaming

- A background inserter appends "current hour" telemetry every few seconds to a live boundary. Normal state = calm baseline.
- The Inject Crisis button perturbs the incoming stream for a chosen film/region — sentiment drops, refunds rise — and Detection fires on the newly arriving rows. Genuinely live, but controlled.
- A "now" marker in the schema distinguishes historical from live rows.

### Ground truth table (powers the accuracy eval)

Per injected crisis, stored: `crisis_id, injection_timestamp, type, affected_film_id(s), affected_region(s), true_root_cause, affected_tables, expected_recommendation, magnitude, resolution_window`. This is what the eval harness scores agent output against to produce the accuracy number (e.g. 24/30).

### Suggested telemetry tables

- `box_office_revenue` (film_id, region, date, revenue, tickets_sold, refunds)
- `streaming_watch_minutes` (film_id, region, timestamp, watch_minutes, completions, drops)
- `trailer_analytics` (trailer_id, film_id, variant, region, timestamp, views, completion_rate, sentiment_score)
- `marketing_spend` (film_id, region, channel, date, spend, impressions, clicks)
- `audience_sentiment` (film_id, region, timestamp, platform, score, volume)
- `social_trends` (film_id, region, timestamp, platform, mentions, sentiment, virality)
- `ticket_refunds` (film_id, region, timestamp, refund_count, refund_reason)
- `review_scores` (film_id, source, timestamp, score, review_count)
- `reviews_text` (film_id, region, timestamp, source, raw_text, sentiment_score) — the 150K text rows
- `competitor_releases` (film_id, region, release_date, competitor_film_id)
- `campaign_performance` (campaign_id, film_id, region, channel, date, spend, conversions)
- `crisis_ground_truth` (see schema above)

All telemetry tables: MergeTree engine, partitioned by `toYYYYMM(date/timestamp)`, ordered by `(film_id, region, timestamp)`.

---

## 3. LAYER 2 — Detection ✓ RESOLVED

Where ClickHouse-track credibility is won or lost. Detection is pure SQL with **zero LLM** — provably deterministic and sub-second. An LLM here would be slower, non-deterministic, and would undercut the exact determinism story told to judges.

### Three complementary detectors, all in SQL

- **Z-score** over a rolling baseline — catches sudden spikes and drops against recent normal.
- **EWMA** (exponentially weighted moving average) — catches gradual drift a z-score misses.
- **%-change** thresholds — the human-legible "sentiment down 28%" signal.

Different crisis types trip different detectors, which is realistic and gives the Investigation Agent richer input.

### Continuous detection via materialized views

ClickHouse materialized views compute rolling aggregates as data streams in, so detection is near-instant and continuous rather than a query you must run. "The database itself is detecting as data lands" is a strong demo moment and a genuine ClickHouse advantage to show off.

### Output and ranking

- Output: a `detections` table row — metric, film/region, detector fired, severity score, baseline vs actual values, timestamp. This triggers Layer 3.
- Severity ranking (magnitude × business-impact weight) escalates the real crisis (EU box-office collapse) and suppresses trivial blips — prevents alert noise.
- Thresholds calibrated against the crisis injector's known magnitudes (ties back to the Layer 1 ground-truth table).

> **Honest flags:** Detection tuning is a real risk — too sensitive gives false alarms in the demo, too loose and the injected crisis doesn't trip fast enough. This layer is fast to build but easy to under-sell — the winning move is making its speed and determinism visible in the UI (sub-second detection on 50M+ rows, shown on screen).

---

## 4. LAYER 3 — MCP + Three LLM Agents ✓ RESOLVED

The heaviest layer and where the "agentic" story lives. A detection firing is just an alert; this layer turns it into an investigation, a decision, and an executive-ready recommendation. Three agents on Google ADK, all reaching ClickHouse through the mcp-clickhouse MCP server (the rules-required path).

> **The mcp-clickhouse boundary (rules-critical):** Every agent read of ClickHouse goes through the mcp-clickhouse MCP server — this is what judges verify. The direct `clickhouse-connect` client is used ONLY by the Layer 1 data generator and Layer 2 materialized-view setup, never by an agent. Build-time tooling uses the direct client; runtime agents use MCP.

### The three agents

- **Investigation Agent** — receives a detection, runs a sequence of MCP-driven queries across all four signal families (numeric drop → text reason → categorical isolation → temporal context), and forms a hypothesis. It narrates what the data shows; it never invents numbers.
- **Decision Agent** — produces recommended actions, each carrying a computed impact figure (from SQL, not the LLM) and an approval threshold: small actions auto-approve, large ones require human sign-off. Every decision writes to an audit trail (PlanAI pattern transfers here).
- **Executive Report Agent** — assembles investigation + decision into an executive summary where every figure links to the ClickHouse query that produced it (query provenance). Nothing looks hallucinated.

### Orchestration and latency

- Sequential pipeline (Detection → Investigation → Decision → Report) for reliability, exposed in the UI as a live agent trace so it reads as a sophisticated multi-agent system (which it is). Reliability beats architectural flash in a 32-day window.
- Latency mitigations from day one: parallel MCP queries within Investigation, aggressive caching, per-agent deterministic fallbacks. Target: full pipeline under ~20 seconds.
- **De-risk step:** build a trivial "agent asks one question through MCP and gets an answer" proof before building the real agents — the mcp-clickhouse integration is the single most likely thing to be fiddly.

> **Honest flag:** This is the biggest build effort of the whole project — budget the most time here. If anything slips, it slips here.

---

## 5. LAYER 4 — Orchestration API ✓ RESOLVED

The connective tissue: FastAPI on Cloud Run, tying the four agents into one pipeline and feeding the UI. The design decisions here are really about what the dashboard will be able to show.

### Streaming — the key decision

The agent pipeline takes 15–20s. Plain request-response means the judge stares at a spinner. Instead, stream the agent trace live via **Server-Sent Events (SSE)**: as each agent starts, works, and finishes, push an event to the UI so the judge watches Detection → Investigation → Decision → Report unfold in real time. That 20 seconds becomes the most compelling part of the demo instead of dead air.

### Core endpoints

| Endpoint | Purpose |
|---|---|
| `POST /inject-crisis` | triggers the injector (the judge's button) |
| `GET /stream/investigation/{id}` | SSE stream of the live agent trace |
| `GET /detections` | current/recent detections for the anomaly feed |
| `GET /audit` | the decision audit trail |
| `GET /metrics/{film}/{region}` | telemetry for charts + ClickHouse latency badge |
| `POST /approve/{decision_id}` | the human approval action on the gate |

### Execution and state

- Pipeline runs as a background task; the endpoint returns an investigation ID immediately, and the UI subscribes to the SSE stream. Timeout-safe and it's what makes the live trace possible.
- Mostly stateless; ClickHouse is the source of truth (detections, audit, ground truth). The API holds only transient in-flight investigation state. A restart loses nothing durable.
- **Demo-safety layer:** pre-warmed pipeline with a cached-investigation fallback if a live LLM call fails mid-demo. Not deception — the investigation is real — but insurance against a network blip during judging.
- `min-instances=1` during the judging window (Sep 23–Oct 7) so a judge's first click isn't a 10-second cold start.

---

## 6. LAYER 5 — UI · Cinematic Dashboard ✓ RESOLVED

The layer that decides the Design score — where strong backends most often lose. Judges watch the video and click the hosted URL before reading any code, so this is disproportionately where placement is won. Every panel renders real data from Layer 4, and every number is traceable to a query.

### Visual direction — cinematic-modern, LIGHT (not dark)

- Light, editorial, spacious — not a dark Datadog clone. It's Agentic Cinema; the UI should feel like a premium product, with one hero focal point per screen (the "Now investigating" banner reads like a film title card).
- Signature accent color used only on the focal element; red/amber reserved strictly for crisis states so they hit when they appear.
- Large/small typographic contrast — big tight-tracked headline numbers, small quiet labels. This is the biggest driver of a "designed" feel. Monospace for queries/IDs to keep "real system internals" credibility.
- Cinematic motion: telemetry lines ease in like a camera move, agent trace reveals with a soft stagger, numbers count rather than snap. Deliberate and cinematic, not bouncy.
- Optional signature touch: subtle cinema-grain or widescreen letterbox framing on the hero banner — on-brand, low effort, memorable in the video.

### The eight workflows (all covered; drill-down deferred)

| # | Workflow | Decision |
|---|---|---|
| 1 | Hero flow: inject → detect → investigate → recommend → approve | Build — the star |
| 2 | Verify a number (query provenance) | Build |
| 3 | Approve / reject a decision | Build |
| 4 | Idle / nominal resting state | Build — calm monitoring |
| 5 | History + replay of past investigations | Build — light version |
| 6 | Crisis-type picker (CGI / competitor / overspend) | Build — cheap, high-value |
| 7 | Error / failure states | Build — non-negotiable |
| 8 | Movie/region drill-down | Deferred — stretch goal |

### The layout and the states

- **Ops-center single screen:** hero investigation banner; telemetry strip with ClickHouse latency badge; anomaly feed (severity-colored); live agent trace (the centerpiece, with MCP queries scrolling); recommendation panel with source queries; approval gate + audit trail; history/inject controls. No horizontal scroll, nothing critical below the fold.
- **Five states per async panel** — idle/nominal, loading (with live sub-status), success, empty, error (graceful, never a frozen spinner). The state most hackathon UIs forget is error; it ties to the Layer 4 safety fallback.
- **The choreographed inject sequence is the 30-second hero moment:** pick crisis type → press inject → a telemetry line visibly starts dropping (a drop you watch happen) → anomaly feed lights up red → agent trace auto-starts → agents resolve top to bottom → recommendation + approval appear. One button, whole system responds, unrehearsed.

> **Honest flag:** This layer wins Design points and it comes last, so the Day 24 feature freeze exists specifically to protect its polish time. Guard it ruthlessly. If time compresses, cut the drill-down and history-scrubbing depth first — never the polish of the hero flow.

---

## 7. LAYER 6 — Submission ✓ RESOLVED

Converting the build into a winning submission. Good projects most often lose points they'd already earned right here — failing Stage 1 on a technicality, or nailing Stage 2 on everything except the video.

### Stage 1 survival — the pass/fail gate

- `mcp-clickhouse` imported AND called in agent code (grep it, prove it).
- `google-genai` / `google-cloud-aiplatform` imported and called.
- Repo public, MIT LICENSE visible in the About section.
- Hosted URL live and reachable from a clean browser.
- Video public, ≤3 min, English. ClickHouse track selected on the form.

### The 3-minute video — worth more than any single feature

| Time | What's on screen |
|---|---|
| 0:00–0:20 | The problem, concretely — studios lose millions to scattered signals |
| 0:20–0:40 | Inject a live crisis on camera (the unrehearsed hero moment) |
| 0:40–2:00 | Agents detect → investigate (MCP queries shown) → recommend (source queries beside figures) |
| 2:00–2:30 | Executive report + approval gate + audit trail |
| 2:30–3:00 | Accuracy result (e.g. 24/30) + one architecture slide |

Open on the working system, architecture last. Record on real screens with real latency — a faked or sped-up demo is often visible and erodes trust. Only the first 3 minutes are evaluated.

### The rest of the submission

- **Writeup:** structure the Devpost text so a judge scoring each criterion finds the evidence immediately — a paragraph each for Technological Implementation, Design, Potential Impact, Quality of the Idea. Include the TMDB data credit. Name the ClickHouse + Gemini + ADK stack explicitly.
- **Eval:** 20–30 injected scenarios scored against Layer 1 ground truth, reported as "correctly identified primary root cause in N/30". Almost no competing submission brings measured accuracy — a real differentiator.
- **Repo:** runnable README, `.env.example` (no secrets), AI-compliance note, architecture diagram, final scan confirming no `service-account.json` or `.env` was ever committed.
- **Deadline:** internal Sep 6 — a full day of buffer before the Sep 7 2:00 PM PT cutoff. Late submissions are simply void.

> **The silent killer — trial expiry:** The hosted URL and database must stay live through the entire judging window (Sep 23–Oct 7). Both the ClickHouse and GCP trials have fixed-date clocks. If either trial period lapses before Oct 7, your live service suspends mid-judging and you cannot fix it after the deadline. Add a credit card to ClickHouse BEFORE the trial ends (day 29) — this flips you to pay-as-you-go with no interruption or data loss. Without it, services stop at day 29 and data is deleted ~2 weeks later.

---

## 8. Credit Budget

Dollar-wise both trials are comfortable. The genuine risk is trial-period expiry timing, not running out of credit.

### ClickHouse Cloud

Compute ~$0.22–$0.30 per compute-unit-hour on Basic/Mini; storage ~$25/TB-month. Basic tier does NOT auto-scale compute to zero when idle (unlike Scale/Enterprise), so a running service bills continuously.

| Phase | Estimate |
|---|---|
| Build phase (Aug–early Sep, intermittent querying) | ~$40–70 |
| Data storage (~50–65M rows compress to well under 10 GB) | a few $/month |
| Judging window kept warm ~2 weeks 24/7 | ~$90–100 |
| **ClickHouse total** | **~$150–180 of the $300 trial** |

**Trial mechanic:** Trial ends at 30 days OR credits depleted, whichever first. Remaining credits expire at trial end (irrelevant — you won't spend $300). Add a credit card before day 29 → auto-switches to pay-as-you-go, service continues. No card → services stop at day 29, data deleted ~2 weeks later. Set an idle timeout during build to conserve credits.

### Google Cloud

| Driver | Estimate |
|---|---|
| Gemini text generation (one-time 150K reviews) | ~$30–80 |
| Cloud Run + Vertex AI agent inference (build + judging) | ~$20–50 |
| **Google Cloud total** | **~$80–150 of $300 trial + $100 hackathon credit** |

> **Bottom line:** Comfortable on dollars for both. The thing that can end your run is a trial PERIOD lapsing before Oct 7. Add the ClickHouse card before day 29; confirm GCP credits cover through judging.

---

## 9. Master Action List

### Immediate (this week)

- Submit the $100 Google Cloud hackathon credit form (deadline Aug 31, 1–5 business day approval).
- **Add a credit card to ClickHouse before day 29** so the service survives into judging (auto-switches to pay-as-you-go; no data loss).
- Confirm GitHub repo `studio-crisis-commander` is public with MIT LICENSE in the About section.
- Register the project on Devpost (rapid-agent.devpost.com); select the ClickHouse track when submitting.
- Get a free TMDB API key and Kaggle API token for the data seed.

### Build sequence (bottom-up)

**Week 1 — Layer 1 (Data)**
- TMDB seed fetch (Kaggle catalog + live API), ClickHouse schema, 50–65M row generator.
- Crisis injector with ground-truth recording; 150K text rows (real + Gemini).

**Week 2 — Layers 2 & 3 (Detection + Agents)**
- Pure-SQL detection (z-score, EWMA, %-change) via materialized views; detections table.
- mcp-clickhouse proof, then Investigation / Decision / Report agents on ADK.

**Week 3 — Layers 4 & 5 (API + UI)**
- FastAPI on Cloud Run with SSE agent trace; deploy.
- Cinematic dashboard: hero banner, telemetry, live trace, recommendations, approval gate, inject button.
- Working end-to-end system by Day 18.

**Week 4 — Differentiators + freeze**
- Multimodal trailer analysis if time allows; eval harness accuracy number.
- HARD FEATURE FREEZE at Day 24 — polish and submission only after this.

**Days 29–32 — Layer 6 (Submission)**
- Record 3-min video (open on live inject); Devpost writeup mapped to criteria; TMDB credit.
- Stage-1 compliance audit; cold-clone repo test; submit before Sep 6 internal deadline.

### Reusable prior work

- **PlanAI** (audit trail + chain-of-thought) → Decision Agent governance.
- **Zeno** (19/22 eval methodology) → root-cause accuracy harness.
- **RepoPulse** (metrics pipeline) → telemetry rollup shape.
- **Course Copilot AI** (RAG grounding) → query provenance.
- **HackForge** (React + FastAPI + RBAC) → dashboard + approval gates.
- **Sterling OMS** (133M+ record scale) → 50M+ row dataset credibility.

You are assembling more than inventing — which is why the aggressive scope cut is affordable.
