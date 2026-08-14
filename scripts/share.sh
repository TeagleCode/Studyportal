#!/usr/bin/env bash
# Share StudyPortal over the internet with a free Cloudflare quick tunnel.
# Usage: bash scripts/share.sh   (Ctrl+C stops sharing)
#
# Needs: cloudflared in PATH (~/.local/bin/cloudflared) — download from
# https://github.com/cloudflare/cloudflared/releases if missing.
# The public URL is random and changes on every run.
set -e
cd "$(dirname "$0")/.."

# The DB container doesn't survive reboots — start it if it's stopped
# (otherwise every login fails with SP-501).
if command -v podman >/dev/null && ! podman ps --format '{{.Names}}' | grep -q '^studyportal-test-db$'; then
  echo "▶ starting database container…"
  podman start studyportal-test-db
  for i in $(seq 1 30); do
    podman exec studyportal-test-db mariadb -ustudyportal -p193824 studyportal -e "SELECT 1" >/dev/null 2>&1 && break
    sleep 2
  done
fi

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

# NOTE: the site now runs as systemd user services instead of this script:
#   systemctl --user status studyportal            # web server
#   systemctl --user status studyportal-tunnel     # public URL
#   cat ~/.local/share/studyportal-url.txt         # current public URL
# They auto-start at boot (linger enabled). The URL changes whenever the
# tunnel restarts — re-read the file above after a reboot.
