#!/usr/bin/env bash
# Cold-clone smoke test. Builds and runs the backend from the current checkout
# using Docker, then verifies /health responds and /detections returns a JSON
# array. Frontend build is verified separately (npm ci + npm run build).
#
# Env required: passthrough for backend. Uses .env if present, otherwise
# reads GEMINI_API_KEY / CLICKHOUSE_* from the environment.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${REPO_ROOT}"

IMAGE="scc-api:smoke"
CONTAINER="scc-api-smoke"
PORT="18100"

cleanup() {
  docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "=== 1/5 build backend image" >&2
docker build --tag "${IMAGE}" backend/ >&2

echo "=== 2/5 run backend container on :${PORT}" >&2
ENV_FILE_ARG=""
if [[ -f .env ]]; then
  ENV_FILE_ARG="--env-file=.env"
fi
docker run -d --rm \
  --name "${CONTAINER}" \
  -p "${PORT}:8080" \
  ${ENV_FILE_ARG} \
  "${IMAGE}" >/dev/null

echo "=== 3/5 wait for /health (up to 30s)" >&2
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    echo "  health ok after ${i}s" >&2
    break
  fi
  sleep 1
  if [[ ${i} -eq 30 ]]; then
    echo "FAIL: /health never returned 200" >&2
    docker logs "${CONTAINER}" >&2 || true
    exit 1
  fi
done

echo "=== 4/5 GET /detections" >&2
BODY=$(curl -sf "http://127.0.0.1:${PORT}/detections?limit=5")
echo "${BODY}" | grep -qE '"detections"[[:space:]]*:[[:space:]]*\[' \
  || { echo "FAIL: /detections response missing detections array"; echo "${BODY}"; exit 1; }

echo "=== 5/5 frontend build" >&2
(cd frontend && npm ci --silent && npm run build --silent) >&2

echo "=== smoke.sh PASSED ==="
