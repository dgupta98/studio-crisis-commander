# Studio Crisis Commander — 3-Minute Demo Shot List

**Target runtime:** 2:45–3:00. Every second earns its place.
**Recording target:** 1920×1080, 60fps, screen capture with cursor visible.
**Voice-over:** conversational, first-person plural ("we"). Comedic hook, deadpan delivery on the pain. Cut ambient tool sound.

---

## Fold 0 · Cold open (0:00 – 0:20)

**On screen:** static "corporate Slack" mock, single frame:

> **VP Marketing → #war-room** · 2:47 AM
> *"Refunds spiking on Aurora in DE. Sentiment tanking in India. Twitter's on fire in Brazil. Trailer B just went live. We pulling this or not?"*
>
> **VP Marketing** · 2:47 AM
> *"@channel"*
>
> **VP Marketing** · 2:48 AM
> *"@here"*
>
> **VP Marketing** · 2:49 AM
> *"hello???"*

Hold 4 seconds. Cursor drifts across the messages like it's reading them.

**VO (deadpan, slightly weary):**
> *"Somewhere, right now, a VP of Marketing is aggressively at-channeling a Slack room at 2 a.m. because three markets are on fire and the war room is asleep. This is a re-enactment. It's also every Tuesday."*

**Cut to** black. Beat. Title card fades in:

```
STUDIO CRISIS COMMANDER
the tool that answers the DM before the war room wakes up
```

Hold 2 seconds. Cut to landing page. Particle cascade blooms.

---

## Fold 1 · The value prop (0:20 – 0:38)

**On screen:** landing hero, camera pans down through the four-agent card grid. Cursor hovers each `SignalChip` in turn (blue, pink, yellow, green).

**VO:**
> *"Four autonomous agents. Fifteen markets. Fifty million rows of telemetry. Every claim they make cites the exact SQL row that produced it — because 'trust me, I'm an LLM' is not a phrase you say to a CFO."*

**Cut** to the `TopBar` eval chip in the dashboard. Zoom-in: `EVAL · 21/30 VERIFIED`.

**VO (over zoom):**
> *"Twenty-one out of thirty. Verified. Reproducible in one command. Vibes are not a metric."*

---

## Fold 2 · The movie-first heat bar (0:38 – 1:05)

**On screen:** Dashboard route. Cursor clicks the `MoviePicker` — types "Aurora". `MovieCommand` header renders. `RegionHeatBar` blooms across the top — 15 markets, each a tiny stacked bar in signal-family colors.

Zoom-in on the heat bar. Three markets pulse red-hot: **DE**, **IND**, **BRA**.

**VO:**
> *"This is the money shot. Every movie, every market, every signal family on one line. Aurora is calm in twelve regions and actively on fire in three."*

Cursor hovers **IND** — tooltip fires. Cursor clicks it. `TimeseriesGrid` swaps: 4-up sparklines for box office, social, streaming, and reviews — the social sparkline has a violent upward tick.

**VO:**
> *"Pick a market, get the four-panel telemetry for that market. This used to be a Jira ticket. Now it's a click."*

---

## Fold 3 · The multi-region inject (1:05 – 1:35)

**On screen:** cursor clicks **Inject Crisis** in the TopBar. Modal opens. `MultiRegionPicker` chip picker is visible.

Fill in:
- **Movie:** Aurora
- **Regions:** click **DE**, **IND**, **BRA** (three chips light up)
- **Crisis type:** `trailer_variant_underperformance`
- **Magnitude:** `1.5σ`

Click **Inject**. Modal closes. Bottom-docked `PipelineTicker` slides up from the bottom edge.

**On screen:** three pills materialize side-by-side, each labeled with a region. Their stage dots start filling left-to-right at slightly different speeds. Cursor hovers them in sequence.

**VO (over the streaming pills):**
> *"One inject, three regions, three parallel pipelines. This is the moment we stopped pretending crises happen one at a time. Detection is pure SQL — we just scanned forty-seven million rows in twelve milliseconds. No LLM in the hot path. Now four sub-agents fan out per region — numeric, text, categorical, temporal — every query through the ClickHouse MCP server."*

Cursor clicks the **IND** pill. The Agent Trace drawer on the right slides in, scoped to the India run. Events cascade:
- `detection.completed` (severity 8.4)
- `signal.completed × 4`
- `hypothesis.formed`
- `action.proposed × 2` with `action.impact_computed`
- `report.completed`

**VO:**
> *"Click any pill, watch that run. The trace is scoped per pipeline. No merging. No accidental cross-talk. No 'wait which region are we looking at.'"*

Target: end fold with `pipeline.completed` for **IND** and the Recommendation panel populated.

---

## Fold 4 · The provenance beat (1:35 – 1:55) *[the differentiator]*

**On screen:** cursor drifts to the top recommended action. Zoom-in on `Impact: $18,540 · view SQL`. Click.

Popover opens with the actual `impact_sql`. Hold. Let the viewer read the first two lines.

**VO (quiet, almost reverent):**
> *"Every dollar figure in a recommendation carries the SQL that produced it. This is not a hallucination. This is not a made-up number. The Pydantic contract layer refuses to construct an action without an attached query — the LLM literally can't ship a claim without receipts."*

Close popover. Cursor drifts to a Key Figure in the report card. Opens the source SQL popover. Hold 2 seconds.

**VO:**
> *"Same rule for every headline number in the report. LLM narrates. SQL computes. Nobody gets away with a vibe."*

---

## Fold 5 · The region picker + time-travel (1:55 – 2:20)

**On screen:** SPA nav to `/movies/aurora`. Movie Detail loads. The Investigation Scope strip is visible with a `<select>` on the right — currently on **India**.

Cursor clicks the select, changes to **Germany**. The Detection, Investigation, and Recommendation panels *all* swap in real time — old India content clears, new Germany content loads.

**VO:**
> *"Region picker. Actually swaps the data. This one took an embarrassing number of commits — turns out if your panels read from a single global store they'll happily lie to you about which market you're looking at. Fixed with a scope-match hook that blanks stale panels before rendering the new region."*

Cursor scrolls down to the **Past Runs** timeline. Clicks a run from last week.

The workspace time-travels: Investigation / Recommendation / Approval all rewind to that historical run's data.

**VO:**
> *"Every past run is clickable. The whole workspace time-travels into it. Investigations don't just happen — they get archived, indexed, and re-openable."*

---

## Fold 6 · Approval + audit (2:20 – 2:40)

**On screen:** back on Dashboard. `ApprovalGate` shows `pending_approval` for the India run. Cursor clicks **Approve**. Panel flips to `approved`. The Recent Runs shelf shows the run in green at the top.

**VO:**
> *"Anything above the impact threshold waits for a human. The audit log is append-only — every approval, every denial, every auto-executed action gets a row you can grep six months later when Legal asks who signed off on what."*

Beat.

**VO:**
> *"Which they will."*

---

## Fold 7 · The close (2:40 – 3:00)

**Cut to** a full-screen recap card:

```
   STUDIO CRISIS COMMANDER

   4 agents · 15 markets · 50M rows · cited to the row
   21 / 30 verified · reproducible in one command
   multi-region · time-travelable · human-gated

   Live:  scc-frontend.us-east1.run.app
   Code:  github.com/dgupta98/studio-crisis-commander
```

**VO:**
> *"Studio Crisis Commander. Watch every signal. Cite every claim. Ship every recommendation. Before the meeting starts. Before the trailer runs another twelve hours. Before somebody @-channels the war room at 2 a.m."*

Beat.

**VO (softer):**
> *"Sleep is a competitive advantage. Ship this to your VP."*

Fade to black. End card holds 1.5 seconds.

---

## Editing checklist

- [ ] Cursor visible throughout; slight highlight ring in the editor
- [ ] Zoom-in on latency badge whenever a query completes (< 500 ms)
- [ ] Multi-region ticker moment — hold on the three pills lighting up in sequence for at least 3 s
- [ ] Region picker on Movie Detail — cut so viewer can see all three panels swap simultaneously (this is the "wow" moment for the movie-first flow)
- [ ] Past-run click — hold on the workspace panels visibly changing content
- [ ] No dead air between beats — cut breaths
- [ ] Music: soft cinematic underscore, drops to almost silence during the provenance beat (Fold 4)
- [ ] Captions on for accessibility (judges may watch muted — the deadpan lines land in text too)
- [ ] Export: `.mp4`, H.264, 12–18 Mbps, YouTube upload as unlisted → paste URL in Devpost
