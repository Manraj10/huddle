#!/usr/bin/env bash
# P0-3 — cheapest Ubuntu box → Node + systemd + Caddy (or cloudflared from the box).
# Run as root on a fresh Vultr VPS. Keeps the laptop tunnel as the thirty-second fallback.
set -euo pipefail

REPO="${REPO:-https://github.com/Manraj10/huddle.git}"
BRANCH="${BRANCH:-master}"
DEST="${DEST:-/opt/huddle}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "run as root: sudo bash deploy/setup.sh" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl git

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

id huddle >/dev/null 2>&1 || useradd --system --home "$DEST" --shell /usr/sbin/nologin huddle

if [[ -d "$DEST/.git" ]]; then
  git -C "$DEST" fetch origin
  git -C "$DEST" checkout "$BRANCH"
  git -C "$DEST" pull --ff-only origin "$BRANCH"
else
  git clone --branch "$BRANCH" "$REPO" "$DEST"
fi

chown -R huddle:huddle "$DEST"
sudo -u huddle bash -lc "cd '$DEST' && npm ci --omit=dev"

install -m 644 "$DEST/deploy/huddle.service" /etc/systemd/system/huddle.service
systemctl daemon-reload
systemctl enable --now huddle.service

if command -v caddy >/dev/null 2>&1 || apt-get install -y caddy; then
  install -m 644 "$DEST/deploy/Caddyfile" /etc/caddy/Caddyfile
  systemctl enable --now caddy.service || true
  systemctl reload caddy.service || true
fi

echo
echo "Huddle is up on :8080 (Caddy on :80 if installed)."
echo "Health:  curl -sS http://127.0.0.1:8080/stats"
echo "Room:    http://<this-box>/room"
echo
echo "TLS without a domain — run cloudflared ON THIS BOX so the URL survives the laptop moving:"
echo "  curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared"
echo "  chmod +x /usr/local/bin/cloudflared"
echo "  install -m 644 $DEST/deploy/cloudflared.service /etc/systemd/system/cloudflared.service"
echo "  systemctl enable --now cloudflared.service"
echo "  journalctl -u cloudflared -n 30   # copy the https://*.trycloudflare.com URL onto the table card"
echo
echo "Keep the laptop tunnel as fallback. Both URLs go on deploy/TABLE-CARD.md"
