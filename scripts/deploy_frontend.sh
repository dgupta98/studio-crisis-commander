#!/usr/bin/env bash
# Deploy frontend (scc-frontend) to Cloud Run.
# Usage: scripts/deploy_frontend.sh <BACKEND_URL>
# BACKEND_URL is baked into the bundle at build time via VITE_API_URL.
set -euo pipefail

BACKEND_URL="${1:?Usage: deploy_frontend.sh <BACKEND_URL>}"
: "${GCP_PROJECT:?GCP_PROJECT must be set}"
REGION="${GCP_REGION:-us-east1}"
SERVICE="scc-frontend"
IMAGE="gcr.io/${GCP_PROJECT}/${SERVICE}:latest"

echo "=== Building ${IMAGE} with VITE_API_URL=${BACKEND_URL}" >&2
# Two-step (build then push) because `gcloud run deploy --source` does NOT
# forward --build-arg to Cloud Build — see frontend/README.md Deploy section.
docker build \
  --build-arg "VITE_API_URL=${BACKEND_URL}" \
  --tag "${IMAGE}" \
  frontend/

docker push "${IMAGE}"

echo "=== Deploying ${SERVICE} to Cloud Run (${REGION})" >&2
gcloud run deploy "${SERVICE}" \
  --project="${GCP_PROJECT}" \
  --region="${REGION}" \
  --image="${IMAGE}" \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080 \
  --memory=256Mi \
  --cpu=0.5 \
  --min-instances=0 \
  --max-instances=3 \
  --concurrency=80 \
  --timeout=60 \
  >&2

URL=$(gcloud run services describe "${SERVICE}" \
  --project="${GCP_PROJECT}" \
  --region="${REGION}" \
  --format='value(status.url)')

echo "${URL}"
