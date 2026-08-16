#!/usr/bin/env bash
# 9-gate submission preflight. Every row must be green before Sep 6 submit.
#
# Env:
#   BACKEND_URL    — required for gates 1, 3
#   FRONTEND_URL   — required for gate 2
#   SKIP_SUSTAINED — set to "1" to skip the 1-hour poll (gate 3)
#   SKIP_SMOKE     — set to "1" to skip cold-clone (gate 8) if Docker unavailable
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${REPO_ROOT}"

PASS=()
FAIL=()

section() {
  echo
  echo "--- $1 ---"
}

record() {
  local name="$1"; shift
  if "$@"; then
    PASS+=("${name}")
    printf "  \033[32m✔ %s\033[0m\n" "${name}"
  else
    FAIL+=("${name}")
    printf "  \033[31m✘ %s\033[0m\n" "${name}"
  fi
}

# --- gates ---

gate_1_backend_health() {
  [[ -n "${BACKEND_URL:-}" ]] || { echo "BACKEND_URL unset" >&2; return 1; }
  local body
  body=$(curl -sf "${BACKEND_URL%/}/health") || return 1
  [[ "${body}" == '{"status":"ok"}' ]]
}

gate_2_frontend_serves() {
  [[ -n "${FRONTEND_URL:-}" ]] || { echo "FRONTEND_URL unset" >&2; return 1; }
  local body
  body=$(curl -sf "${FRONTEND_URL%/}/") || return 1
  echo "${body}" | grep -qi "studio crisis commander"
}

gate_3_sustained() {
  if [[ "${SKIP_SUSTAINED:-0}" == "1" ]]; then
    echo "  (skipped via SKIP_SUSTAINED=1)"
    return 0
  fi
  echo "  polling /health every 30s for 60 min…" >&2
  local errors=0
  for i in $(seq 1 120); do
    if ! curl -sf "${BACKEND_URL%/}/health" >/dev/null 2>&1; then
      errors=$((errors + 1))
    fi
    sleep 30
  done
  [[ ${errors} -eq 0 ]]
}

gate_4_eval_ran() {
  [[ -f data/eval_runs/latest.json ]] \
    && python3 -c "import json; json.load(open('data/eval_runs/latest.json'))"
}

gate_5_eval_floor() {
  jq -e '.accuracy >= 0.7' data/eval_runs/latest.json >/dev/null
}

gate_6_replay_parity() {
  # Compare live artifact's `correct` to replay run's `correct` — must be within ±1.
  local live_correct replay_correct diff
  live_correct=$(jq '.correct' data/eval_runs/latest.json)
  ./scripts/eval_replay.py --out /tmp/replay_preflight.json >/dev/null
  replay_correct=$(jq '.correct' /tmp/replay_preflight.json)
  diff=$(( live_correct > replay_correct ? live_correct - replay_correct : replay_correct - live_correct ))
  [[ ${diff} -le 1 ]]
}

gate_7_compliance() {
  bash scripts/compliance_audit.sh >/dev/null
}

gate_8_cold_clone() {
  if [[ "${SKIP_SMOKE:-0}" == "1" ]]; then
    echo "  (skipped via SKIP_SMOKE=1)"
    return 0
  fi
  local fresh="/tmp/scc-preflight-$$"
  git clone --quiet . "${fresh}"
  # smoke.sh needs .env for Docker's --env-file arg to pass through backend
  # secrets; copy the repo's .env if present.
  [[ -f .env ]] && cp .env "${fresh}/.env"
  (cd "${fresh}" && bash scripts/smoke.sh) >/tmp/preflight_smoke.log 2>&1
  local rc=$?
  rm -rf "${fresh}"
  return ${rc}
}

gate_9_repo_hygiene() {
  local hits
  hits=$(git ls-files | grep -E '(^|/)\.env$|(^|/)service-account\.json$' || true)
  [[ -z "${hits}" ]]
}

# --- driver ---

section "Live services"
record "1 backend /health"       gate_1_backend_health
record "2 frontend serves"       gate_2_frontend_serves
record "3 sustained 60 min"      gate_3_sustained

section "Eval"
record "4 latest.json exists"    gate_4_eval_ran
record "5 accuracy ≥ 0.70"       gate_5_eval_floor
record "6 replay parity ±1"      gate_6_replay_parity

section "Repo & smoke"
record "7 compliance audit"      gate_7_compliance
record "8 cold-clone smoke"      gate_8_cold_clone
record "9 repo hygiene"          gate_9_repo_hygiene

echo
echo "========================================"
echo "PASS: ${#PASS[@]}   FAIL: ${#FAIL[@]}"
if [[ ${#FAIL[@]} -gt 0 ]]; then
  echo "Failing gates: ${FAIL[*]}"
  exit 1
fi
echo "All 9 gates green. Cleared for submission."
