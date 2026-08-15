#!/usr/bin/env bash
# Create or update the Cloud Scheduler warmup job.
# Usage: scripts/warmup_scheduler.sh <BACKEND_URL>
# Fires GET <BACKEND_URL>/health every 4 minutes to keep the backend warm.
set -euo pipefail

BACKEND_URL="${1:?Usage: warmup_scheduler.sh <BACKEND_URL>}"
: "${GCP_PROJECT:?GCP_PROJECT must be set}"
REGION="${GCP_REGION:-us-east1}"
JOB="scc-warmup"
TARGET="${BACKEND_URL%/}/health"

# `gcloud scheduler jobs describe` exits nonzero if the job doesn't exist —
# distinguish "not-found" from other errors before deciding create vs update.
if gcloud scheduler jobs describe "${JOB}" \
     --project="${GCP_PROJECT}" --location="${REGION}" >/dev/null 2>&1; then
  ACTION=update
else
  ACTION=create
fi

echo "=== ${ACTION} scheduler job ${JOB} → ${TARGET} (*/4 * * * *)" >&2
gcloud scheduler jobs "${ACTION}" http "${JOB}" \
  --project="${GCP_PROJECT}" \
  --location="${REGION}" \
  --schedule="*/4 * * * *" \
  --uri="${TARGET}" \
  --http-method=GET \
  --time-zone="Etc/UTC" \
  >&2

echo "Scheduler configured: ${JOB} → ${TARGET}" >&2
