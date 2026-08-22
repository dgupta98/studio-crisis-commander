# Demo Video Beats — L7 UI

**Total: ~3:00. 13 beats across 4 routes. 1080p, MP4, YouTube unlisted → public at submission.**

Recording: OBS Studio or QuickTime against the live URL (`https://scc-frontend-845114229642.us-east1.run.app`). Editing: iMovie (or Descript for transcript-based cuts). Auto captions + hand-corrected. No third-party logos beyond the hackathon badge and our repo URL.

---

| # | Time  | Beat                                    | Surface           | Voiceover cue |
|---|-------|-----------------------------------------|-------------------|---------------|
| 1 | 0:00  | Landing hero, particle cascade, headline | /                 | "Data lands. Investigations start." |
| 2 | 0:15  | Live counters ticking                    | / (hero fold)     | "250 films, 15 regions, 120 days." |
| 3 | 0:25  | Scroll to agents fold                    | /                 | "Four agents. One narrative." |
| 4 | 0:40  | Click Open Dashboard                     | /dashboard        | "Real ingest, real detections." |
| 5 | 0:50  | Intake strip animating                   | /dashboard        | "Rows landing every 2 seconds." |
| 6 | 1:00  | Click Inject Crisis                      | /dashboard modal  | "Simulate a box office drop." |
| 7 | 1:15  | Investigation → recommendation tabs      | /dashboard        | "Investigation, then decision." |
| 8 | 1:35  | Approve action                           | /dashboard        | "Human in the loop." |
| 9 | 1:50  | Nav to Movies                            | /movies           | "Every film has its own thread." |
|10 | 2:05  | Featured hero rotator                    | /movies           | "Pre-run investigations, cached for playback." |
|11 | 2:15  | Click a featured film                    | /movies/:id       | "One click, full investigation." |
|12 | 2:35  | Persistent Agent Trace scroll            | /movies/:id       | "Every step, with SQL provenance." |
|13 | 2:55  | Landing CTA reprise                      | /                 | "Detecting data as it lands." |

---

## Recording checklist

- [ ] Warm up backend (`curl https://scc-api-845114229642.us-east1.run.app/health`) before recording
- [ ] Trigger inject reliably from cold state (test 3× before recording)
- [ ] Featured film has cached triple in `data/eval_cache/` — verify `sc_001.json` loads at `/movies/1`
- [ ] Mic gain: no clipping; -12 dB headroom
- [ ] Screen resolution locked to 1920x1080
- [ ] Close all browser tabs except the demo tab; hide bookmarks bar
- [ ] Terminal font size ≥ 16pt if any editor is visible
- [ ] Export MP4, H.264, 30 fps, ~10 Mbps
- [ ] Upload YouTube **unlisted** — flip to public at submission

## Manual review before publish

- [ ] Audio audible at earbud levels
- [ ] No third-party logos visible in any frame
- [ ] Total runtime ≤ 180 s (Devpost hard limit)
- [ ] Captions auto-generated and hand-corrected for the numbers
