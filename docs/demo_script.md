# Studio Crisis Commander — Demo Script

**Runtime:** ~3 min · **Voice-over:** first-person plural, deadpan.

---

## The problem

*(On screen: Slack DM mockup — "@channel Refunds spiking in DE. Sentiment tanking in India. Twitter's on fire in Brazil. Pulling the trailer or not?" — 3 escalations, 2 a.m.)*

> Somewhere right now, a VP of marketing is aggressively at-channeling a Slack room at 2 a.m. because three markets are on fire and the war room is asleep. This is a re-enactment. It's also every Tuesday.

> The data to answer the question exists. It's in a warehouse — fifty million rows across two-hundred-fifty films, fifteen regions, four signal families. The problem isn't observability. The problem is coordination — five Slack threads, three notebooks, and a VP.

---

## What we built to fix it

*(Cut to landing page. Cursor pans down the four-agent card grid.)*

> Four agents. Every claim they make cites the exact SQL row that produced it — because "trust me, I'm an LLM" is not a phrase you say to a CFO.

*(Zoom in on eval chip: `EVAL · 21/30 VERIFIED`.)*

> Twenty-one of thirty — verified, reproducible in one command. Vibes are not a metric.

**How the agents find and fix it (say this over the pipeline card grid):**

> **Detection** is pure SQL — rolling z-scores against a per-film baseline, no LLM in the hot path. It's how we scan forty-seven million rows in twelve milliseconds.

> **Investigation** fans out to four grounded sub-agents — numeric, text, categorical, temporal. Every query flows through the ClickHouse MCP server. Every finding carries the SQL it ran.

> **Decision** ranks one to three actions, each with a dollar impact *and* the SQL that computed it. Our Pydantic contract literally rejects an action that doesn't attach the query.

> **Report** writes the executive summary. Every headline number carries a popover with the source query.

---

## Video flow

### 1 · Movie-first heat bar *(0:35 – 1:00)*

*(Dashboard route. Type "Aurora" in FilmPicker → header renders. RegionHeatBar blooms.)*

> This is the money shot. Every movie, every market, every signal family on one line. Aurora is calm in twelve regions and actively on fire in three.

*(Hover then click IND. TimeseriesGrid swaps to 4-up sparklines — social has a violent upward tick.)*

> Pick a market, get four-panel telemetry for that market. This used to be a Jira ticket. Now it's a click.

---

### 2 · Multi-region inject *(1:00 – 1:35)*

*(Click Inject Crisis. In modal: Film=Aurora, Regions=DE + IND + BRA, Crisis=trailer_variant_underperformance, Magnitude=1.5σ. Click Inject.)*

*(Bottom-docked PipelineTicker slides up. Three pills materialize side-by-side, one per region. Stage dots fill left-to-right.)*

> One inject, three regions, three parallel pipelines. This is the moment we stopped pretending crises happen one at a time.

*(Click the IND pill. Agent Trace drawer slides in, scoped to India. Events cascade: detection → 4 signals → hypothesis → 2 actions → report.)*

> Click any pill, watch that run. Traces are scoped per pipeline — no merging, no cross-talk, no "wait which region are we looking at."

---

### 3 · The provenance beat *(1:35 – 1:55)* — **hold camera steady here**

*(Click "view SQL" on the top action. Popover opens with the actual `impact_sql`. Hold ~3s.)*

> Every dollar figure carries the SQL that produced it. This is not a hallucination. The Pydantic contract layer refuses to construct an action without an attached query — the LLM literally can't ship a claim without receipts.

*(Close. Click a Key Figure in the report. Same popover pattern.)*

> Same rule for every headline number. LLM narrates. SQL computes. Nobody gets away with a vibe.

---

### 4 · Region picker + past-run time-travel *(1:55 – 2:20)*

*(Navigate to `/movies/aurora`. Investigation Scope strip visible with region select on India.)*

*(Change select to Germany. All three right-column panels swap — Investigation, Recommendation, Approval — live.)*

> Region picker. Actually swaps the data across every panel. Took an embarrassing number of commits.

*(Scroll to Past Runs timeline. Click a run from last week.)*

> Every past run is clickable. The whole workspace time-travels into it. Investigations don't just happen — they get archived, indexed, and re-openable.

---

### 5 · Approval + audit *(2:20 – 2:40)*

*(Back on Dashboard. ApprovalGate shows `pending_approval` for the India run. Click Approve → flips to `approved`.)*

> Anything above the impact threshold waits for a human. The audit log is append-only — every approval, every denial, every auto-executed action gets a row you can grep six months later when Legal asks who signed off on what.

*(Beat.)*

> Which they will.

---

### 6 · Close *(2:40 – 3:00)*

*(Full-screen recap card:)*

```
STUDIO CRISIS COMMANDER

4 agents · 15 markets · 50M rows · cited to the row
21 / 30 verified · reproducible in one command
multi-region · time-travelable · human-gated

Live: scc-frontend.us-east1.run.app
Code: github.com/dgupta98/studio-crisis-commander
```

> Studio Crisis Commander. Watch every signal. Cite every claim. Ship every recommendation. Before the meeting starts. Before the trailer runs another twelve hours. Before somebody @-channels the war room at 2 a.m.

*(Softer:)*

> Sleep is a competitive advantage.

*(Fade to black. Hold 1.5s.)*
