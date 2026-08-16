# Submission Checklist (Sep 6)

## Automated preflight

Run `bash scripts/preflight.sh` — all 9 gates must be green.

| # | Gate |
|---|---|
| 1 | Backend `/health` returns 200 |
| 2 | Frontend serves index.html with brand marker |
| 3 | Sustained-uptime poll (60 min, /health) — zero errors |
| 4 | `data/eval_runs/latest.json` exists + parses |
| 5 | `latest.json` accuracy ≥ 0.70 |
| 6 | Live vs replay parity within ±1 correct |
| 7 | `scripts/compliance_audit.sh` exits 0 |
| 8 | Cold-clone smoke exits 0 |
| 9 | No `.env` or `service-account.json` committed |

## Manual gates

### Deploy
- [ ] `scripts/deploy_all.sh` ran green; both Cloud Run URLs recorded in README `## Live Demo`
- [ ] `scc-warmup` Cloud Scheduler job is present and enabled
- [ ] ClickHouse Cloud credit card added
- [ ] $100 credit form submitted (**hard deadline: Aug 31**)

### Video
- [ ] 3-min MP4 recorded, edited per `docs/video_beats.md`
- [ ] ≤ 180 s runtime
- [ ] Audio audible at earbud levels
- [ ] No third-party logos visible in any frame
- [ ] Auto-captions hand-corrected for the numbers
- [ ] Uploaded YouTube unlisted (flip to **public** at submission)

### Devpost
- [ ] Project created on Devpost
- [ ] **ClickHouse track** selected
- [ ] Writeup pasted from `docs/devpost_writeup.md`; `N/30` and URLs replaced with final values
- [ ] All 4 media slots filled (video, screenshots, thumbnail, logo)
- [ ] "Try it out" link → frontend Cloud Run URL
- [ ] "GitHub" link → public repo URL

### Repo hygiene
- [ ] README `## Accuracy` has final `N/30` pasted from `data/eval_runs/latest.json`
- [ ] README `## Live Demo` has real Cloud Run URLs and YouTube link
- [ ] `MIT LICENSE` at repo root
- [ ] GitHub About-section badge (hackathon)
- [ ] Repo is **public**

## Ceremony steps

1. `bash scripts/preflight.sh` → all green.
2. Final live eval:
   ```
   BACKEND_URL=… ./scripts/eval_live.py
   ```
   Copy `correct/total` and today's date into README `## Accuracy`.
3. Commit as `docs: bake final eval accuracy N/30`.
4. Flip YouTube video from unlisted → public.
5. Submit on Devpost with ClickHouse track locked in.
6. `git tag v1.0-submitted && git push --tags`.
7. Screenshot Devpost confirmation → `docs/submission_confirmation.png`.

## If a gate fails

- **Gate 1/2/3 red:** backend/frontend broken or warmup misbehaving. `gcloud scheduler jobs pause scc-warmup` + `gcloud run services update scc-api --min-instances=1` as documented in README rollback.
- **Gate 5 red:** accuracy under floor. Rerun `./scripts/eval_live.py` once more (Gemini variance); if still red, investigate a specific failing scenario type via `per_type` in `latest.json` and either retune prompts or drop the two lowest-hit scenarios (documented as `--exclude` flag if time permits, otherwise manual).
- **Gate 6 red:** live vs replay diverged by more than 1. Rerun `./scripts/eval_record.py` to refresh the cache and rerun preflight.
- **Gate 8 red:** cold-clone broken — likely a missing file from `.dockerignore` or a required env var. Read `/tmp/preflight_smoke.log`.
