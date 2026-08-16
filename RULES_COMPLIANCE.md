# Studio Crisis Commander — Rules & Compliance Reference

> Build-time reference for hackathon rules. Check every item before submitting.
> Agentic Cinema: The Blockbuster Hackathon · ClickHouse Track.

| | |
|---|---|
| Submission deadline | September 7, 2026 @ 2:00 PM PT (internal target: Sep 6) |
| Contest opens | July 27, 2026 — project must be new code from this date |
| Credit form deadline | August 31, 2026 11:59 PM PST |
| Judging period | September 23 – October 7, 2026 |
| Winners announced | On or about October 7, 2026 |
| Selected track | ClickHouse — 1st $7,500 · 2nd $3,000 · 3rd $2,000 |

---

## 1. Critical Disqualifiers — these eliminate you

| Rule | Status | Action required |
|---|---|---|
| **Google-only AI at runtime** — no OpenAI, Anthropic, AWS AI, LangChain w/ non-Google backends, Llama, Mistral | ⚠️ | Only Gemini, Google ADK, Agent Builder, BigQuery ML. Verify every `pip install` has no non-Google AI lib. |
| **ClickHouse via mcp-clickhouse MCP server** — not direct clickhouse-connect client | ⚠️ | Agents must call ClickHouse through the official `mcp-clickhouse` MCP server at runtime. Direct client alone fails Stage 1. |
| **New project only** — no reuse of existing code (RepoPulse, Course Copilot, HackForge) | ⚠️ | Patterns/knowledge fine. No copy-paste of existing source files. Fresh repo created after July 27. |
| **Partner service imported AND called at runtime** — not just in README | ⚠️ | Judge clones repo and verifies. `mcp-clickhouse` must be in requirements.txt and called in agent code. |
| **Public repo with OSS license visible in About section** | ⚠️ | MIT LICENSE file. GitHub About section shows the license badge. |
| **Hosted project URL live and accessible** | ⚠️ | Cloud Run. Must stay up during judging Sep 23–Oct 7. |
| **Demo video ≤ 3 min, public on YouTube/Vimeo, English or subtitled** | ⚠️ | Only first 3 min evaluated. No third-party logos/ads. Must show agent functioning as built. |
| **Submission received before Sep 7, 2026 2:00 PM PT** | ⚠️ | Set Sep 6 internal deadline. Late = void. |
| Not a resident of excluded country (US resident — clean) | ✅ | Clean. |
| Above age of majority | ✅ | Clean. |
| Not a Google/Devpost/partner employee | ✅ | Clean. |
| Team max 4 people — all added as Devpost members | ✅ | Solo or add up to 3. |

---

## 2. AI Tool Restriction — Allowed vs Blocked

Rule 7B: "Projects may only use Google Cloud artificial intelligence tools. No other AI models, agent frameworks, or AI APIs are permitted, regardless of vendor." This is a Stage 1 pass/fail check — one blocked library in requirements.txt can eliminate you.

| Category | Tool / Library | Allowed? |
|---|---|---|
| LLM | Gemini (via Vertex AI / google-genai) | ✅ Required |
| Agent framework | Google ADK (google-cloud-aiplatform[adk]) | ✅ Required |
| Agent platform | Google Agent Builder / Agent Engine | ✅ Required |
| Data / ML | BigQuery ML | ✅ Allowed |
| Database MCP | mcp-clickhouse (official ClickHouse MCP server) | ✅ Required for track |
| LLM | OpenAI GPT (any model) | ❌ Disqualifier |
| LLM | Anthropic Claude (any model, at runtime) | ❌ Disqualifier |
| LLM | AWS Bedrock / SageMaker AI | ❌ Disqualifier |
| LLM | Meta Llama / Mistral / Cohere | ❌ Disqualifier |
| Agent framework | LangChain (with non-Google LLM backend) | ❌ Disqualifier |
| Agent framework | LlamaIndex / AutoGen / CrewAI | ❌ Disqualifier |
| DB client | clickhouse-connect (as sole integration) | ❌ Fails track requirement |
| Non-AI libs | FastAPI, React, Recharts, python-dotenv, etc. | ✅ Fine — restriction is AI/agent tooling only |

> **Note on Claude/AI coding assistants:** Using AI (including Claude) to WRITE the code is fine — the restriction is on what the DEPLOYED APP calls at runtime. Your runtime AI stack must be Google-only. No `anthropic`, `openai`, `langchain`-with-non-Google, etc. in the shipped code.

---

## 3. Accepted packages (must appear in requirements.txt AND be called)

**Google Cloud (pick any, all count equally):**
- `google-adk`
- `google-genai`
- `google-generativeai`
- `google-cloud-aiplatform` (any generation — legacy libraries count)

**ClickHouse track:**
- `mcp-clickhouse` — must actively connect to a ClickHouse Cloud or self-hosted cluster at runtime via the official ClickHouse MCP server.

---

## 4. Submission Requirements Checklist

| Deliverable | Status | Detail |
|---|---|---|
| Devpost account + project created | ⚠️ | Register at rapid-agent.devpost.com |
| Google Cloud project created (studio-crisis-cmd) | ✅ | $300 trial active |
| Hackathon $100 credit form submitted | ⚠️ | Deadline Aug 31. 1–5 business day approval. |
| Vertex AI API enabled | ⚠️ | GCP console → APIs & Services |
| Agent Builder API enabled | ⚠️ | GCP console |
| Cloud Run Admin API enabled | ⚠️ | GCP console |
| Secret Manager API enabled | ⚠️ | GCP console |
| Service account created with correct roles | ⚠️ | Vertex AI User + Agent Engine User + Secret Manager Accessor |
| service-account.json in .gitignore before first commit | ⚠️ | Critical. Never commit credentials. |
| ClickHouse Cloud service created (Mini, us-east1) | ✅ | $300 trial active |
| **ClickHouse credit card added before day 29** | ⚠️ | Prevents service stop + data deletion during judging |
| GitHub repo public (studio-crisis-commander) | ⚠️ | MIT LICENSE in About section. Fresh — no prior code. |
| mcp-clickhouse in requirements.txt + called at runtime | ⚠️ | Verify before any other agent work. |
| Hosted URL (Cloud Run) live and accessible | ⚠️ | Must stay up Sep 23–Oct 7. |
| Text description written (features, tech, data, learnings) | ⚠️ | Map to the 4 judging criteria. |
| 3-min demo video (YouTube/Vimeo, public, English) | ⚠️ | Opens on live Inject Crisis. |
| Select ClickHouse partner track on Devpost form | ⚠️ | Cannot change after. |

---

## 5. Judging — Two Stages

**Stage 1 (Pass/Fail):** submission completeness, reasonable challenge address, Google Cloud + partner used at runtime. May use automated tools. Fails here = eliminated before human review.

**Stage 2 (scored, equal weight):**

| Criterion | What judges look for |
|---|---|
| Technological Implementation | How well is it built; how effectively does it use Google Cloud + ClickHouse? |
| Design | A complete, coherent product experience, not just a proof of concept |
| Potential Impact | Credible, specific problem, real audience, real solution |
| Quality of the Idea | Creative, non-obvious use; genuine problem-space understanding |

**Ties** broken by criterion order (Tech → Design → Impact → Idea), then judge vote. Winners notified ~Oct 7, must respond within 2 business days or prize forfeited.

---

## 6. Prize Breakdown (official rules — overview page had wrong numbers)

| Track | 1st | 2nd | 3rd |
|---|---|---|---|
| IBM | $7,500 | $4,500 | $3,000 |
| Grafana | $7,500 | $3,000 | $2,000 |
| Parallel | $7,500 | $3,000 | $2,000 |
| **ClickHouse (selected)** | **$7,500** | **$3,000** | **$2,000** |
| Replit | $7,500 | $3,000 | $2,000 |

Each track's 1st place also gets an opportunity for social media promotion.

---

## 7. Key Dates

| Date | Event |
|---|---|
| July 27, 2026 | Contest opens — project must be new from this date |
| August 31, 2026 11:59 PM PST | $100 credit form deadline |
| ~Day 29 of ClickHouse trial | Add credit card before this or service stops |
| September 6, 2026 | Internal submission deadline (buffer) |
| September 7, 2026 2:00 PM PT | Official submission deadline — late = void |
| September 23 – October 7, 2026 | Judging period — hosted URL must be live |
| On or about October 7, 2026 | Winners announced |
| Within 2 business days of notification | Must respond or forfeit |

---

## 8. Data Source Compliance

- **TMDB** (The Movie Database) — used for real film catalog + live popularity/reviews. Free for non-commercial use. **Must be credited** in README and Devpost description per TMDB terms.
- TMDB is a DATA source, not an AI tool — it does not count against the Google-only AI restriction.
- Any third-party data used must be authorized under its terms (rules requirement).
