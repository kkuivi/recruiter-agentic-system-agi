#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PY="${PYTHON:-/Users/eykuivi/.local/bin/python3.11}"
if [[ ! -x "$PY" ]]; then
  PY="$(command -v python3)"
fi

if [[ ! -x services/panel/.venv/bin/python ]]; then
  "$PY" -m venv services/panel/.venv
  services/panel/.venv/bin/pip install -r services/panel/requirements.txt
fi

mkdir -p data
pids=()
cleanup() {
  for pid in "${pids[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

bun apps/actor/src/server.ts &
pids+=($!)
bun apps/orchestrator/src/index.ts &
pids+=($!)
services/panel/.venv/bin/uvicorn main:app --app-dir services/panel --host 127.0.0.1 --port 8000 &
pids+=($!)

sleep 0.6
cd "$ROOT/apps/web"
bun run dev
