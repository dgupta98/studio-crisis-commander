#!/usr/bin/env bash
# Deploy frontend (scc-frontend) to Cloud Run — build runs in Cloud Build,
# no local Docker daemon required.
#
# Usage: scripts/deploy_frontend.sh <BACKEND_URL>
# BACKEND_URL is baked into the bundle at build time via VITE_API_URL.
set -euo pipefail

BACKEND_URL="${1:?Usage: deploy_frontend.sh <BACKEND_URL>}"
: "${GCP_PROJECT:?GCP_PROJECT must be set}"
REGION="${GCP_REGION:-us-east1}"
SERVICE="scc-frontend"
IMAGE="gcr.io/${GCP_PROJECT}/${SERVICE}:latest"

echo "=== Building ${IMAGE} via Cloud Build (VITE_API_URL=${BACKEND_URL})" >&2
# `gcloud run deploy --source` does NOT forward --build-arg to Cloud Build,
# so we drive Cloud Build directly with a config file that injects the arg.
gcloud builds submit \
  --project="${GCP_PROJECT}" \
  --config=frontend/cloudbuild.yaml \
  --substitutions="_IMAGE=${IMAGE},_VITE_API_URL=${BACKEND_URL}" \
  frontend/

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
