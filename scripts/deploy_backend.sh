#!/usr/bin/env bash
# Deploy backend (scc-api) to Cloud Run. Reads GCP_PROJECT and
# GCP_REGION from env; defaults to us-east1. Echoes the deployed URL
# on stdout so callers can capture it: BACKEND_URL=$(scripts/deploy_backend.sh)
set -euo pipefail

: "${GCP_PROJECT:?GCP_PROJECT must be set}"
REGION="${GCP_REGION:-us-east1}"
SERVICE="scc-api"
IMAGE="gcr.io/${GCP_PROJECT}/${SERVICE}:latest"

echo "=== Building ${IMAGE} via Cloud Build" >&2
gcloud builds submit \
  --project="${GCP_PROJECT}" \
  --tag="${IMAGE}" \
  backend/

echo "=== Deploying ${SERVICE} to Cloud Run (${REGION})" >&2
gcloud run deploy "${SERVICE}" \
  --project="${GCP_PROJECT}" \
  --region="${REGION}" \
  --image="${IMAGE}" \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080 \
  --memory=1Gi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=5 \
  --concurrency=20 \
  --timeout=300 \
  --set-secrets="GEMINI_API_KEY=gemini-api-key:latest,CLICKHOUSE_URL=clickhouse-url:latest,CLICKHOUSE_USER=clickhouse-user:latest,CLICKHOUSE_PASSWORD=clickhouse-password:latest,MCP_CLICKHOUSE_URL=mcp-clickhouse-url:latest" \
  >&2

URL=$(gcloud run services describe "${SERVICE}" \
  --project="${GCP_PROJECT}" \
  --region="${REGION}" \
  --format='value(status.url)')

echo "${URL}"
