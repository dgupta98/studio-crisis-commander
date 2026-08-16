#!/usr/bin/env bash
# Deploy backend (scc-api) to Cloud Run. Reads GCP_PROJECT and
# GCP_REGION from env; defaults to us-east1. Echoes the deployed URL
# on stdout so callers can capture it: BACKEND_URL=$(scripts/deploy_backend.sh)
#
# Required Secret Manager secrets (create these once via Console or gcloud):
#   CLICKHOUSE_HOST        → CLICKHOUSE_HOST     (e.g. abc.us-east1.gcp.clickhouse.cloud)
#   CLICKHOUSE_USER        → CLICKHOUSE_USER
#   CLICKHOUSE_PASSWORD    → CLICKHOUSE_PASSWORD
#   CLICKHOUSE_DB          → CLICKHOUSE_DB       (e.g. studio_crisis)
# CLICKHOUSE_PORT is a plain env var (8443 TLS default) — not a secret.
#
# Gemini calls use Vertex AI via the runtime service account (no API key needed).
# One-time setup:
#   gcloud services enable aiplatform.googleapis.com --project=${GCP_PROJECT}
#   PROJECT_NUM=$(gcloud projects describe ${GCP_PROJECT} --format='value(projectNumber)')
#   gcloud projects add-iam-policy-binding ${GCP_PROJECT} \
#     --member="serviceAccount:${PROJECT_NUM}-compute@developer.gserviceaccount.com" \
#     --role=roles/aiplatform.user
set -euo pipefail

: "${GCP_PROJECT:?GCP_PROJECT must be set}"
REGION="${GCP_REGION:-us-east1}"
SERVICE="scc-api"
IMAGE="gcr.io/${GCP_PROJECT}/${SERVICE}:latest"

echo "=== Building ${IMAGE} via Cloud Build" >&2
gcloud builds submit \
  --project="${GCP_PROJECT}" \
  --tag="${IMAGE}" \
  backend/ >&2

echo "=== Deploying ${SERVICE} to Cloud Run (${REGION})" >&2
gcloud run deploy "${SERVICE}" \
  --project="${GCP_PROJECT}" \
  --region="${REGION}" \
  --image="${IMAGE}" \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080 \
  --memory=2Gi \
  --cpu=2 \
  --min-instances=0 \
  --max-instances=5 \
  --concurrency=4 \
  --timeout=300 \
  --set-env-vars="CLICKHOUSE_PORT=8443,GOOGLE_GENAI_USE_VERTEXAI=true,GOOGLE_CLOUD_PROJECT=${GCP_PROJECT},GOOGLE_CLOUD_LOCATION=us-east4,GEMINI_MODEL_FLASH=gemini-2.5-flash,GEMINI_MODEL_PRO=gemini-2.5-pro" \
  --set-secrets="CLICKHOUSE_HOST=CLICKHOUSE_HOST:latest,CLICKHOUSE_USER=CLICKHOUSE_USER:latest,CLICKHOUSE_PASSWORD=CLICKHOUSE_PASSWORD:latest,CLICKHOUSE_DB=CLICKHOUSE_DB:latest" \
  >&2

URL=$(gcloud run services describe "${SERVICE}" \
  --project="${GCP_PROJECT}" \
  --region="${REGION}" \
  --format='value(status.url)')

echo "${URL}"
