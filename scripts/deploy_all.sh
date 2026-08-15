#!/usr/bin/env bash
# Orchestrate a full Cloud Run rollout:
#   1. Deploy backend, capture URL.
#   2. Deploy frontend against that URL.
#   3. Point Scheduler warmup at that URL.
# Idempotent — safe to rerun.
set -euo pipefail

: "${GCP_PROJECT:?GCP_PROJECT must be set}"
export GCP_REGION="${GCP_REGION:-us-east1}"

HERE="$(cd "$(dirname "$0")" && pwd)"

echo "=== 1/3 backend" >&2
BACKEND_URL="$(bash "${HERE}/deploy_backend.sh")"
echo "backend: ${BACKEND_URL}" >&2

echo "=== 2/3 frontend" >&2
FRONTEND_URL="$(bash "${HERE}/deploy_frontend.sh" "${BACKEND_URL}")"
echo "frontend: ${FRONTEND_URL}" >&2

echo "=== 3/3 scheduler warmup" >&2
bash "${HERE}/warmup_scheduler.sh" "${BACKEND_URL}"

echo
echo "=== DONE ==="
echo "backend:  ${BACKEND_URL}"
echo "frontend: ${FRONTEND_URL}"
echo "warmup:   scc-warmup (${GCP_REGION}) → ${BACKEND_URL}/health every 4 min"
