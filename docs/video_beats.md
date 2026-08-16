# Video Beats — 3-min voice-over walkthrough

**Total: 180 s. Six beats × 30 s. 1080p, MP4, YouTube unlisted → public at submission.**

Recording: OBS Studio or QuickTime. Editing: iMovie (or Descript for transcript-based cuts). Auto captions + hand-corrected. No third-party logos beyond the hackathon badge and our repo URL.

---

## Beat 1 (0:00 – 0:30) — Cold open

**Visual:** Ops-center idle. Empty AgentTrace panel. AnomalyFeed with 3 historical anomalies visible. Slow zoom on the hero panel's "Waiting for anomaly · system nominal" state.

**Voice-over:**
> "Studio Crisis Commander detects box-office anomalies in real time and recommends action, backed by fifty million rows of ClickHouse telemetry."

---

## Beat 2 (0:30 – 1:00) — Inject

**Visual:** Cursor moves to InjectControls. Click ▾ dropdown, select `regional_sentiment_collapse`. Click Inject. Hero panel flashes; the letterbox bars snap in; "Now Investigating" appears.

**Voice-over:**
> "The Detection layer runs pure SQL against ClickHouse — rolling z-scores, no LLM in the hot path. Latency: milliseconds."

---

## Beat 3 (1:00 – 1:30) — Investigation

**Visual:** AgentTrace centerpiece fills with four SignalFinding cards animating in. Each card shows a signal name and the truncated SQL that produced it. Camera slow-zooms on the SQL block of `text_reason`.

**Voice-over:**
> "The Investigation agent runs eight grounded queries via the mcp-clickhouse MCP server. Every narrative sentence traces back to specific rows returned by a specific query."

---

## Beat 4 (1:30 – 2:00) — Recommendation

**Visual:** RecommendationPanel cards animate in — three ranked actions with `impact_usd` and priority chips. Hover the top card; provenance popover opens showing the `impact_sql`.

**Voice-over:**
> "Each recommendation cites the exact ClickHouse query that produced its dollar estimate. LLM narrates, SQL computes — enforced at the contract layer."

---

## Beat 5 (2:00 – 2:30) — Approval

**Visual:** ApprovalGate panel highlights. Cursor moves to Approve button, clicks. Green checkmark animation. Approval echo appears in the AgentTrace.

**Voice-over:**
> "Human-in-the-loop is enforced by policy. Any action above the impact threshold gates on approval before execution."

---

## Beat 6 (2:30 – 3:00) — The money shot

**Visual:** Cut to a full-screen shot of `data/eval_runs/latest.json` open in the editor. Overlay: large bold text "N/30 correctly identified primary root cause." Fade to logo card with GitHub URL and hackathon badge.

**Voice-over:**
> "Measured accuracy — a real number, not a claim. Studio Crisis Commander: from anomaly to approved action in three minutes."

---

## Recording checklist

- [ ] Trigger inject reliably from cold state (test 3× before recording)
- [ ] Mic gain: no clipping; -12 dB headroom
- [ ] Screen resolution locked to 1920x1080
- [ ] Close all browser tabs except the demo tab; hide bookmarks bar
- [ ] Terminal font size ≥ 16pt for the money-shot beat
- [ ] Export MP4, H.264, 30 fps, ~10 Mbps
- [ ] Upload YouTube **unlisted** — flip to public at submission

## Manual review before publish

- [ ] Audio audible at earbud levels
- [ ] No third-party logos visible in any frame
- [ ] Total runtime ≤ 180 s (Devpost hard limit)
- [ ] Captions auto-generated and hand-corrected for the numbers
