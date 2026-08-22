# Studio Crisis Commander — AI Build Context

Paste this entire document at the start of every coding session.
This is the single source of truth for all build decisions.

---

## Project identity

- Name: Studio Crisis Commander
- Type: Autonomous AI operations center for film studios
- Hackathon: Agentic Cinema: The Blockbuster Hackathon (Google Cloud x ClickHouse track)
- Deadline: September 7, 2026 @ 2:00 PM PT
- Repo: github.com/[USERNAME]/studio-crisis-commander
- Prize: $7,500 (1st), $3,000 (2nd), $2,000 (3rd) — ClickHouse track only

---

## Hard rules — never violate these

1. ONLY Google Cloud AI at runtime: Gemini (google-genai), Google ADK
   (google-cloud-aiplatform[adk]), Agent Builder, Vertex AI.
   NO OpenAI, NO Anthropic API, NO LangChain, NO LlamaIndex, NO CrewAI, NO Mistral.

2. ClickHouse must be accessed via mcp-clickhouse MCP server at runtime.
   The direct clickhouse-connect client is allowed only for data generation/seeding.
   All agent ClickHouse calls must go through MCP — judges verify this.

3. Project must be new code — no copying from RepoPulse, Course Copilot, HackForge,
   or any prior project. Patterns and logic are fine; copy-pasted source files are not.

4. mcp-clickhouse must appear in requirements.txt AND be called in agent code.
   google-genai or google-cloud-aiplatform must appear in requirements.txt.

5. Repo must stay public with MIT LICENSE visible in the GitHub About section.

6. No secrets in code or git. All credentials via .env (gitignored) locally,
   Google Secret Manager in production.

---

## Infrastructure already set up

### Google Cloud
- Project ID: studio-crisis-cmd
- Organization: asu.edu (ASU Google Workspace)
- Account: dgupta98@asu.edu
- Free trial: $300 credit, 90 days
- Service account: studio-crisis-agent@studio-crisis-cmd.iam.gserviceaccount.com
- Roles granted: Vertex AI User, Agent Engine User, Secret Manager Secret Accessor
- Credentials: service-account.json (local, gitignored)
- Location: us-east1 (matches ClickHouse)

### ClickHouse Cloud
- Tier: Mini (12GB, 1 replica)
- Provider: GCP, us-east1 (S. Carolina)
- Host: [FROM .env — do not hardcode]
- Port: 8443 (TLS)
- Database: [as configured in .env]
- Status: Connected and verified

### Local environment
- OS: macOS
- Python: 3.12
- Path: /Users/dipgupmac/Downloads/Hackathons/studio-crisis-commander/
- Backend venv: backend/venv (activated with source venv/bin/activate)
- Both ClickHouse and Vertex AI smoke tests passing

---

## Architecture decisions (locked)

### Four agents only — do not add more
1. Detection Agent — pure ClickHouse SQL (window functions, z-scores, EWMA). Zero LLM.
2. Investigation Agent — mcp-clickhouse MCP calls. LLM narrates SQL-computed values.
3. Decision Agent — approval threshold gates + persistent audit trail.
4. Executive Report Agent — every figure sourced from a ClickHouse query shown inline.

Forecast and Root Cause are capabilities inside Investigation, not separate agents.

### Detection is pure SQL — never LLM
The Detection Agent must use only ClickHouse SQL for anomaly detection.
Reason: determinism, speed, and credibility with ClickHouse track judges.

### LLM narrates, SQL computes
The LLM's job is to interpret and communicate SQL-computed results.
The LLM must never generate specific numbers (percentages, dollar amounts) independently.
Every figure in recommendations must trace to a ClickHouse query shown in the UI.

### Dataset scale: 50M+ rows
1M rows is a Postgres workload. ClickHouse track judges expect to see CH advantages.
Show sub-second aggregation latency in the UI on 50M+ rows.
Use streaming inserts during the live demo.

### Inject Crisis button
A randomized scenario injector — NOT a pre-scripted demo.
Judge presses it live. System handles an unrehearsed anomaly.
Ground truth recorded at injection for the eval harness.

### Approval gates
Decision Agent has configurable thresholds:
- Auto-execute below threshold (e.g., budget shift < $10K)
- Require human approval above threshold
- Full audit trail: timestamp, agent, query, decision, action taken

---

## File structure

```
studio-crisis-commander/
├── backend/
│   ├── agents/
│   │   ├── detection_agent.py
│   │   ├── investigation_agent.py
│   │   ├── decision_agent.py
│   │   └── report_agent.py
│   ├── mcp/
│   │   └── clickhouse_mcp.py
│   ├── data/
│   │   ├── schema.sql
│   │   └── generator.py
│   ├── main.py
│   └── requirements.txt
├── frontend/                # React 18 + Vite + TS + Tailwind + Framer Motion + Zustand + React Router + React Query
│   └── src/
│       ├── routes/          # Landing, Dashboard, Movies, MovieDetail, Audit, Settings
│       ├── landing/         # HeroFold, AgentsFold, HowItWorks, CtaFold, ParticleCascade, LiveCounter
│       ├── panels/          # AgentTrace, AnomalyFeed, RecommendationPanel, ApprovalGate, TelemetryStrip, IntakeStrip, MovieHero, LatestInvestigation, RunTimeline, AmbientTelemetry
│       ├── components/      # AppShell, TopBar, GlobalInjectModal, SignalChip, LatencyBadge, RegionFlag, MovieCard, Shelf, FeaturedHero
│       ├── store/           # runStore, catalogStore, signalStore
│       ├── hooks/           # useIntakeRates, useFilm, useCachedTriple, useRegion, useReducedMotion
│       └── router.tsx
├── eval/
│   └── harness.py
├── .env.example
├── .gitignore
├── LICENSE
└── README.md
```

---

## requirements.txt (locked — do not change AI packages)

```
# Google Cloud — required by hackathon rules
google-cloud-aiplatform[agent_engines,adk]>=1.101.0
google-genai>=1.0.0
vertexai

# ClickHouse MCP — required for ClickHouse track
mcp-clickhouse>=0.1.0

# Direct client — for data generation only, not agent calls
clickhouse-connect>=0.7.0

# API
fastapi>=0.111.0
uvicorn[standard]>=0.29.0

# Utilities
python-dotenv>=1.0.0
pydantic>=2.0.0
```

---

## .env structure (never put real values here)

```
CLICKHOUSE_HOST=
CLICKHOUSE_PORT=8443
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=
CLICKHOUSE_DB=

GOOGLE_CLOUD_PROJECT=studio-crisis-cmd
GOOGLE_CLOUD_LOCATION=us-east1
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
```

---

## ClickHouse schema (to build in Week 1)

Tables needed:
- box_office_revenue (film_id, region, date, revenue, tickets_sold, refunds)
- streaming_watch_minutes (film_id, region, timestamp, watch_minutes, completions, drops)
- trailer_analytics (trailer_id, film_id, variant, region, timestamp, views, completion_rate, sentiment_score)
- marketing_spend (film_id, region, channel, date, spend, impressions, clicks)
- audience_sentiment (film_id, region, timestamp, platform, score, volume)
- social_trends (film_id, region, timestamp, platform, mentions, sentiment, virality)
- ticket_refunds (film_id, region, timestamp, refund_count, refund_reason)
- review_scores (film_id, source, timestamp, score, review_count)
- competitor_releases (film_id, region, release_date, competitor_film_id)
- campaign_performance (campaign_id, film_id, region, channel, date, spend, conversions)

All tables use MergeTree engine. Partitioned by toYYYYMM(date or timestamp).
Ordered by (film_id, region, timestamp) or equivalent.

---

## Crisis scenarios for injector (randomized, not pre-scripted)

Types of crises the injector should be able to generate:
1. Regional sentiment collapse (e.g., EU audience negative CGI reaction)
2. Trailer variant underperformance (one variant drives drop-off at specific scene)
3. Competitor release impact (competitor opening weekend eating box office)
4. Marketing overspend with low ROI (spend rising, conversions flat)
5. Streaming completion rate drop (content quality signal)
6. Refund spike (audience dissatisfaction signal)
7. Social media virality — negative (bad press going viral)
8. Review score divergence (critics vs audience gap widening)

Each injection: randomize type + region + magnitude + timestamp.
Record ground truth (type, affected_metric, root_cause, expected_recommendation).

---

## Judging criteria and how to score

### Technological Implementation (equal weight)
- mcp-clickhouse called at runtime, visible in code — CHECK
- Google ADK orchestrating multi-step agent pipeline — BUILD
- Gemini doing investigation + narration — BUILD
- ClickHouse advantages visible (latency display, 50M+ rows) — BUILD

### Design (equal weight — biggest risk)
- Working dashboard by Day 18 is non-negotiable
- Inject Crisis button, agent trace, recommendation panel with queries shown
- Approval gate UI, audit trail visible
- Must feel like a product, not a demo script

### Potential Impact (equal weight)
- Studio ops is a real, specific enterprise problem — already strong
- Frame users as studio marketing and distribution crews (per rules: "studio crews")
- Quantify: "reduces crisis response from hours to minutes"

### Quality of the Idea (equal weight)
- Multimodal trailer analysis (scene captioning vs drop-off) — add if time allows
- Inject Crisis button turning weakness into strength — BUILD
- Root-cause accuracy eval (N/30 scenarios) — BUILD
- Visible query provenance — BUILD

---

## Build timeline

### Week 1 — Foundation (Days 1–7)
- [x] GCP project created
- [x] ClickHouse Cloud created
- [x] Service account created
- [x] Python env + packages installed
- [x] ClickHouse + Vertex AI smoke tests passing
- [ ] GitHub repo created with README + LICENSE
- [ ] $100 credit form submitted (deadline Aug 31)
- [ ] ClickHouse schema created (schema.sql)
- [ ] Synthetic data generator (50M+ rows)
- [ ] Crisis injector with ground truth recording

### Week 2 — Core Intelligence (Days 8–14)
- [ ] mcp-clickhouse MCP server configured
- [ ] Detection Agent (SQL anomaly detection)
- [ ] Investigation Agent (MCP-grounded correlation)
- [ ] Decision Agent (approval gates + audit trail)
- [ ] FastAPI skeleton with agent endpoints

### Week 3 — Orchestration and Dashboard (Days 15–21)
- [ ] Four-agent orchestration with state
- [ ] Cloud Run deployment
- [ ] React dashboard (anomaly feed, agent trace, recommendations)
- [ ] Inject Crisis button live
- [ ] Working end-to-end system by Day 18

### Week 4 — Differentiators (Days 22–28)
- [ ] Multimodal trailer analysis (if time allows)
- [ ] Eval harness (30 scenarios, accuracy reported)
- [ ] Cost/token accounting display
- [ ] HARD FREEZE Day 24

### Days 29–32 — Submission
- [ ] 3-min demo video (YouTube/Vimeo, public, English)
- [ ] Repo final check (public, MIT license, mcp-clickhouse in code)
- [ ] Devpost submission (text description, hosted URL, video URL, ClickHouse track)
- [ ] Internal deadline: Sep 6 (one day before official)

---

## Dipesh's background (relevant to build decisions)

- 4+ years backend engineering: IBM Sterling OMS, data pipelines at 133M+ record scale
- Prior hackathon wins:
  - PlanAI: agent-swarm + audit trail (reuse pattern for Decision Agent)
  - Zeno: 19/22 eval methodology (reuse for root-cause accuracy harness)
  - HackForge: React + FastAPI + RBAC (reuse for frontend patterns)
  - Lofty Morning Handoff: real-time AI + Web Speech API
- RepoPulse: metrics pipeline (LOC, churn, cycle time) — same shape as studio telemetry
- Course Copilot AI: RAG + LLM grounding — query provenance pattern
- ASU MS Software Engineering (AI minor), 4.0 GPA
- Fall 2026 courses: CSE 511 Data Processing at Scale, SER 541 Data Science for SE

---

## Session instructions for AI assistant

When asked to build any component:
1. Never use non-Google AI libraries — Gemini + ADK only
2. All ClickHouse agent queries must go through mcp-clickhouse, not direct client
3. LLM narrates SQL results — never generates specific numbers
4. Every figure displayed must link to its source query
5. Keep the four-agent structure — do not suggest adding agents
6. Write production-quality code, not demo scripts
7. If something conflicts with the rules above, flag it before writing code
8. Target Python 3.12, FastAPI, React + Vite

Current priority: [UPDATE THIS EACH SESSION]
- Week 1: ClickHouse schema + synthetic data generator
