# Studio Crisis Commander — 3-Minute Demo Shot List

**Target runtime:** 2:45–3:00. Every second earns its place.
**Recording target:** 1920×1080, 60fps, screen capture with cursor visible.
**Voice-over:** conversational, first-person plural ("we"). Cut ambient tool sound.

---

## Fold 0 · Cold open (0:00 – 0:18)

**On screen:** a fake studio-side Slack message, static, single frame:

> **VP Marketing → #war-room** · 2:47 AM
> *"Refunds spiking on Aurora in Germany. Trailer B just went live. Do we pull it or wait for the room to wake up?"*

Hold on the message for 3 seconds. Fade.

**Cut to** the SCC landing page loading. Particle cascade blooms.

**VO:**
> *"Every studio has this DM at 2 a.m. — a signal you can see, a decision you can't make yet. Studio Crisis Commander is the tool that answers it before the meeting starts."*

---

## Fold 1 · The value prop (0:18 – 0:35)

**On screen:** landing hero, camera slowly pans down through the four-agent card grid. Cursor hovers each `SignalChip` in turn.

**VO:**
> *"Four autonomous agents watch box office, social, reviews, and streaming across 15 regions. Every claim they make cites the exact SQL that produced it. Anomaly to recommendation in under 90 seconds."*

**Cut** to the `TopBar` eval chip in the dashboard. Zoom-in: `Eval · N/30 verified`.

**VO (over zoom):**
> *"Not vibes — verified on 30 scenarios, reproducible with one command."*

---

## Fold 2 · The inject moment (0:35 – 1:10)

**On screen:** Dashboard route. Cursor clicks **Inject Crisis** in TopBar. Modal opens.

Fill in:
- Film: *Aurora* (or whatever featured film shows Trailer B scenario)
- Region: DE
- Crisis type: `trailer_variant_regression`
- Magnitude: `1.5σ`

Click **Inject**. Modal closes. SPA nav lands on `/movies/{aurora}`.

**On screen:** the Movie Detail hero briefly renders, then the persistent Agent Trace begins streaming:
- `detection.started` → `detection.completed` (severity 8.4, magnitude 1.5)
- `signal.completed` × 4 (each sub-agent, its SQL, its narrative)
- `hypothesis.formed`
- `action.proposed` × 2, `action.impact_computed` × 2
- `report.completed`

**VO (over the stream):**
> *"Detection is pure SQL — this box just scanned 47 million rows in 12 milliseconds. No LLM in the hot path. Now four sub-agents fan out: numeric, categorical, temporal, and text — each grounded through the ClickHouse MCP server. Then the decision agent synthesizes them into ranked actions with dollar-figure impact estimates. Then the report writes it up."*

Timing target for this fold: end at ~1:10 with `pipeline.completed` on screen and the Recommendation panel populated.

---

## Fold 3 · The provenance beat (1:10 – 1:35) *[the differentiator]*

**On screen:** cursor hovers the first recommended action. Zoom-in on the "Impact: $X · view SQL" button. Click it. Popover opens with the exact `impact_sql` query.

Hold. Let the viewer read the first two lines of SQL.

**VO:**
> *"This dollar figure — every recommendation carries one — isn't a hallucination. It's the result of the SQL you're looking at. LLM narrates, SQL computes. If the Pydantic layer can't attach a query to a number, the decision never leaves the agent."*

Close the popover. Cursor drifts to a Key Figure in the report, opens its source SQL popover too. Hold 2 seconds.

**VO:**
> *"Same rule for every headline number in the report."*

---

## Fold 4 · The approval + audit (1:35 – 2:05)

**On screen:** back on Dashboard. Show the Approval panel with `pending_approval`. Cursor clicks **Approve**. Panel flips to `approved`. `RecentRuns` in the left column now shows the run in green at the top of the list.

**VO:**
> *"Anything above the impact threshold waits for a human. The audit log is append-only — every approval, denial, and executed action gets a row you can grep later."*

Cursor drifts to the RecentRuns panel. Click one of the older runs — SPA nav to `/movies/{that film}`. LatestInvestigation panel renders instantly from `data/eval_cache`.

**VO:**
> *"Featured films replay from a cached bundle so the demo never depends on a cold Cloud Run instance."*

---

## Fold 5 · The stack + the sponsors (2:05 – 2:30)

**On screen:** wide static shot of the architecture diagram (from README or spec doc). Highlight in sequence:
- ClickHouse Cloud (blue outline)
- mcp-clickhouse MCP server (blue outline)
- Google ADK + Gemini via Vertex AI (green outline)
- Cloud Run + Cloud Scheduler + Secret Manager (green outline)

**VO:**
> *"Under the hood: ClickHouse Cloud runs 50 million rows of synthetic telemetry seeded from the TMDB catalog. Every agent's ClickHouse access flows through the mcp-clickhouse MCP server — zero direct DB calls from agent code. Gemini via Vertex AI does the narration. Everything ships on Cloud Run in the same region as ClickHouse for millisecond round-trips."*

---

## Fold 6 · The close (2:30 – 2:55)

**Cut to** a full-screen recap card:

```
Studio Crisis Commander
  4 agents  ·  50M rows  ·  cited to the row
  N/30 verified  ·  reproducible in one command

  Live:  scc-frontend.us-east1.run.app
  Code:  github.com/dgupta98/studio-crisis-commander
```

**VO:**
> *"Studio Crisis Commander. Watch every signal. Cite every claim. Ship every recommendation — before the meeting starts."*

Fade to black. End card holds for 1.5 seconds.

---

## Editing checklist

- [ ] Cursor visible throughout; use a slight highlight ring in the editor
- [ ] Zoom-in on latency badge whenever a query completes (< 500 ms)
- [ ] No dead air between beats — cut breaths
- [ ] Music: soft cinematic underscore, drops to almost silence during the provenance beat
- [ ] Captions on for accessibility (judges may watch muted)
- [ ] Export: `.mp4`, H.264, 12–18 Mbps, YouTube upload as unlisted → paste URL in Devpost
