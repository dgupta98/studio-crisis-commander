#!/usr/bin/env bash
# Deploy backend (scc-api) to Cloud Run. Reads GCP_PROJECT and
# GCP_REGION from env; defaults to us-east1. Echoes the deployed URL
# on stdout so callers can capture it: BACKEND_URL=$(scripts/deploy_backend.sh)
#
# Required Secret Manager secrets (create these once via Console or gcloud):
#   gemini-api-key         → GEMINI_API_KEY
#   clickhouse-host        → CLICKHOUSE_HOST     (e.g. abc.us-east1.gcp.clickhouse.cloud)
#   clickhouse-user        → CLICKHOUSE_USER
#   clickhouse-password    → CLICKHOUSE_PASSWORD
#   clickhouse-db          → CLICKHOUSE_DB       (e.g. studio_crisis)
# CLICKHOUSE_PORT is a plain env var (8443 TLS default) — not a secret.
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
  --set-env-vars="CLICKHOUSE_PORT=8443" \
  --set-secrets="GEMINI_API_KEY=gemini-api-key:latest,CLICKHOUSE_HOST=clickhouse-host:latest,CLICKHOUSE_USER=clickhouse-user:latest,CLICKHOUSE_PASSWORD=clickhouse-password:latest,CLICKHOUSE_DB=clickhouse-db:latest" \
  >&2

URL=$(gcloud run services describe "${SERVICE}" \
  --project="${GCP_PROJECT}" \
  --region="${REGION}" \
  --format='value(status.url)')

echo "${URL}"
