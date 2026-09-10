#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

required_major=24

if command -v node >/dev/null 2>&1; then
  node_major="$(node -p "Number(process.versions.node.split('.')[0])")"
  if [ "$node_major" -ge "$required_major" ]; then
    echo "Node $(node -v) detected; skipping Node installation."
  else
    echo "Node $(node -v) detected, but MDCz WebUI requires Node ${required_major} or newer." >&2
    echo "Install Node ${required_major}+ and run this script again." >&2
    exit 1
  fi
else
  echo "Node.js is not installed. Install Node ${required_major}+ and run this script again." >&2
  exit 1
fi

if [ ! -f "$DIR/.env" ] && [ -f "$DIR/.env.example" ]; then
  cp "$DIR/.env.example" "$DIR/.env"
  echo "Created .env from .env.example."
fi

corepack pnpm@10.28.2 install --prod --frozen-lockfile

echo "MDCz WebUI dependencies are ready. Start with: ./start.sh"
