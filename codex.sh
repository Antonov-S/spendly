#!/usr/bin/env bash
# codex.sh - run Codex CLI fully scoped to this repo (bash / Git Bash counterpart
# of codex.ps1). Same two containment levers (see
# docs/features/codex-integration-spec.md Sec 2):
#   1. CODEX_HOME pinned to ./.codex  -> no files written to ~/.codex
#   2. local node_modules binary       -> no global `npm i -g` footprint
#
# CODEX_HOME must point at a directory that ALREADY EXISTS or Codex errors at
# startup, so this launcher creates .codex/ on first run.
#
# Secrets: if a gitignored .codex.env exists next to this script, its KEY=value
# lines are loaded into the environment (e.g. CONTEXT7_API_KEY for the context7
# MCP header) so you never export them by hand. Copy .codex.env.example to get
# started. The file is gitignored and never committed.
# Usage:  ./codex.sh [codex args...]   e.g.  ./codex.sh --version
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export CODEX_HOME="$SCRIPT_DIR/.codex"
mkdir -p "$CODEX_HOME"

if [ -f "$SCRIPT_DIR/.codex.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$SCRIPT_DIR/.codex.env"
  set +a
fi

CODEX_BIN="$SCRIPT_DIR/node_modules/.bin/codex"
if [ ! -x "$CODEX_BIN" ] && [ ! -f "$CODEX_BIN" ]; then
  echo "Local Codex binary not found at $CODEX_BIN. Run: npm i -D @openai/codex@0.142.5" >&2
  exit 1
fi

exec "$CODEX_BIN" "$@"
