#!/usr/bin/env bash
# Share StudyPortal over the internet with a free Cloudflare quick tunnel.
# Usage: bash scripts/share.sh   (Ctrl+C stops sharing)
#
# Needs: cloudflared in PATH (~/.local/bin/cloudflared) — download from
# https://github.com/cloudflare/cloudflared/releases if missing.
# The public URL is random and changes on every run.
set -e
cd "$(dirname "$0")/.."

if ! curl -sf -o /dev/null http://localhost:3000/; then
  echo "▶ starting server…"
  node server.js &
  SERVER_PID=$!
  trap 'kill $SERVER_PID 2>/dev/null' EXIT
  for i in $(seq 1 20); do
    curl -sf -o /dev/null http://localhost:3000/ && break
    sleep 0.5
  done
fi

echo "▶ opening tunnel… (the https://…trycloudflare.com line below is your public URL)"
exec cloudflared tunnel --url http://localhost:3000
