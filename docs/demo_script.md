# Studio Crisis Commander — Demo Script

**Runtime:** ~2:00 · **~300 words** at ~150 wpm
**Delivery:** conversational, first-person, one take
**Post:** cut the pipeline wait — narration overlaps continuously

---

## 🎬 0:00 – 0:08 · LANDING

> **Screen:** Landing page

**SAY:**

> Welcome to Studio Crisis Commander.
>
> From here we can jump into the Dashboard — or browse our movies.
>
> Let's start with browsing.

**DO:** Click **Browse Movies**

---

## 🎞 0:08 – 0:25 · MOVIE DETAIL

> **Screen:** Movies shelf → click **Spider-Man: Brand New Day**

**SAY:**

> I'll pick a featured film — **Spider-Man: Brand New Day**.
>
> Every region already has a full agent run —
>
> the trace shows every SQL query, every decision, every report.
>
> Below that — Investigation, Recommendation, Approvals, past runs.

**DO:** Change region dropdown → **India** *(panels swap)*

---

## 📊 0:25 – 0:42 · DASHBOARD

> **Screen:** Click Dashboard

**SAY:**

> Back to the Dashboard — it remembers the last movie you viewed.
>
> Pick a region and the telemetry follows —
>
> box office, streaming, sentiment, trailer, revenue —
>
> plus the top regions where this movie's performing.

**DO:** Click a region on the heat bar *(sparklines update)*

---

## 💥 0:42 – 0:55 · INJECT CRISIS

> **Screen:** Click **Inject Crisis**
> **Fill:** type = `competitor_release_impact` · regions = NA + UK + India · click **Inject**

**SAY:**

> Now the real thing.
>
> Our agents watch every signal as data lands in ClickHouse.
>
> Let me inject a competitor release crisis across **NA, UK, and India**.

---

## ⚡ 0:55 – 1:15 · TICKER + LIVE TRACE

> **Screen:** PipelineTicker slides up with 3 pills → click **NA** pill

**SAY:**

> Three pipelines fire in parallel.
>
> Clicking the NA pill opens the live trace —
>
> detection runs for Spider-Man Brand New Day, magnitude 0.55.

**DO:** Click **UK** pill briefly, then return to NA

**SAY:**

> The UK run does the same in parallel.

---

## 🧠 1:15 – 1:35 · INVESTIGATION + DECISION + REPORT

> **Screen:** Sub-agent events cascade · findings populate · Recommendation panel fills

**SAY:**

> Four sub-agents fan out — numeric, text, categorical, temporal.
>
> Every query is **real SQL** — no LLM hallucination.
>
> Numeric context lands: North America box office dropped over three days.
>
> The synthesis forms with **high confidence**.
>
> The decision agent recommends shifting marketing spend to email and social —
>
> and every dollar figure carries the SQL that produced it.

---

## 🏗 1:35 – 1:50 · ABOUT THE PLATFORM

> **Screen:** Scroll to the four-agent card grid on Landing OR stay on trace

**SAY:**

> Four Gemini agents, backed by ClickHouse over the mcp-clickhouse server.
>
> **Detection is pure SQL** — no LLM in the hot path.
>
> Every recommendation, every headline number, cites the exact SQL that produced it.

---

## 📈 1:50 – 2:00 · RESULTS

> **Screen:** Point at the `EVAL · 21/30 VERIFIED` chip in the TopBar

**SAY:**

> **21 of 30** crisis scenarios correctly identified —
>
> verified, reproducible in one command.

---

## ✨ 2:00 – 2:15 · WHAT'S NEXT

> **Screen:** Navigate to **What Next?** tab

**SAY:**

> Next up — one intelligence hub across every source.
>
> YouTube, Instagram, TikTok, X, IMDb, Wikipedia, blogs, news, OTT.
>
> Same four agents. More places to look. Same rule — every claim cited to the row.

---

## 🎬 2:15 – 2:20 · CLOSE

**SAY:**

> Studio Crisis Commander —
>
> before somebody @-channels the war room at 2 a.m.

*[Fade to black.]*

---

## 📋 Recording checklist

- [ ] Cursor visible · slight highlight on click
- [ ] Cut the ~30-40s pipeline dead air in post — narration overlaps
- [ ] Region dropdown swap visible on same take
- [ ] Hold the eval chip long enough to read the number
- [ ] End on the What Next tab — that's the vision card
- [ ] Export 1080p60 · H.264 · ~15 Mbps · YouTube unlisted → paste in Devpost
