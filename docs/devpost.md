# Studio Crisis Commander — Devpost

## Elevator pitch
Detecting data as it lands. Four agents turn raw signal ingest into an executive brief in under a second.

## What's new in L7
- Full multi-route product (Landing / Dashboard / Movies / Movie Detail)
- Cinematic landing page with per-family particle cascade
- Netflix-style catalog with cached featured investigations
- Persistent Agent Trace across the app
- Cached playback for featured films (`data/eval_cache/*.json`) with live pipeline fallback for the rest

## Live demo
- Frontend: https://scc-frontend-845114229642.us-east1.run.app
- Backend: https://scc-api-845114229642.us-east1.run.app
- Video (3 min): https://youtu.be/<id>

## Track
ClickHouse — 50M+ rows, streaming ingest, MAD-Z detection.

## Stack
React 18 · Vite · TypeScript · Tailwind · Framer Motion · Zustand · React Router · React Query · FastAPI · Google ADK · Gemini · ClickHouse · mcp-clickhouse

## Accuracy
See README `## Accuracy` — updated from the final live eval run on submission day.

## Credits
Movie metadata via [TMDB API](https://www.themoviedb.org/) — this product uses the TMDB API but is not endorsed or certified by TMDB.
