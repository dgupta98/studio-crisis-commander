#!/usr/bin/env bash
# Stage-1 hackathon compliance audit.
# Fails loud on:
#   - forbidden Python/JS libs anywhere in dependency manifests
#   - missing Google-only AI lib in backend/requirements.txt
#   - missing mcp-clickhouse in backend/requirements.txt
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${REPO_ROOT}"

fail() { echo "FAIL: $*" >&2; exit 1; }

FORBIDDEN_PY=(openai anthropic cohere mistralai llama langchain llamaindex autogen crewai)
for lib in "${FORBIDDEN_PY[@]}"; do
  if grep -iE "^${lib}([[:space:]<>=~!]|$)" backend/requirements.txt >/dev/null 2>&1; then
    fail "forbidden Python lib '${lib}' in backend/requirements.txt"
  fi
done

FORBIDDEN_JS=(openai @anthropic-ai cohere @mistralai langchain llamaindex)
for lib in "${FORBIDDEN_JS[@]}"; do
  if grep -iE "\"${lib}[^\"]*\":" frontend/package.json >/dev/null 2>&1; then
    fail "forbidden JS lib '${lib}' in frontend/package.json"
  fi
done

grep -qE "^(google-adk|google-genai|google-generativeai|google-cloud-aiplatform)" \
  backend/requirements.txt || fail "no Google AI lib in backend/requirements.txt"

grep -qE "^mcp-clickhouse" backend/requirements.txt \
  || fail "mcp-clickhouse missing from backend/requirements.txt"

# Repo hygiene: ensure secrets never got committed.
if git ls-files | grep -E '(^|/)\.env$|(^|/)service-account\.json$' >/dev/null 2>&1; then
  fail "secrets committed to repo: $(git ls-files | grep -E '(^|/)\.env$|(^|/)service-account\.json$')"
fi

echo "=== Stage-1 audit PASSED ==="
