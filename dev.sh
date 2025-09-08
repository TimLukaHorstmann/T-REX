#!/usr/bin/env bash
set -euo pipefail

# One-command dev server: serves frontend and backend together on http://localhost:8000
# - Frontend is mounted by FastAPI from the repo's frontend/ directory
# - Backend API is available under /api

# Run from repo root to ensure paths resolve
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Use uv to run with the project environment; --app-dir so imports resolve
exec uv run uvicorn main:app \
  --reload \
  --host 127.0.0.1 \
  --port 8000 \
  --app-dir backend/api
