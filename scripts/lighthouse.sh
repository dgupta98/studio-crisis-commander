#!/usr/bin/env bash
set -euo pipefail
BASE="${LH_BASE_URL:-https://scc-frontend-845114229642.us-east1.run.app}"
mkdir -p reports/lighthouse
for route in "" dashboard movies movies/1; do
  slug="${route//\//_}"
  slug="${slug:-landing}"
  npx lighthouse "$BASE/$route" \
    --preset=desktop \
    --output=html \
    --output-path="reports/lighthouse/$slug.html" \
    --chrome-flags="--headless=new"
done
