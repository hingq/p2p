#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is not installed. Please install Node.js and npm first." >&2
  exit 1
fi

cd "$ROOT_DIR"

echo "Project root: $ROOT_DIR"
echo "Installing dependencies for Lerna-managed npm workspaces..."

if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi

echo "Dependency installation completed."
