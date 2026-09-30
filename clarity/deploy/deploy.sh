#!/usr/bin/env bash
# Развёртывание Clarity на VPS (Ubuntu/Debian) одной командой с вашего компьютера:
#   ./deploy/deploy.sh user@server-ip [domain]
# Домен по умолчанию — <IP>.sslip.io (HTTPS работает без покупки домена).
# Требуется SSH-доступ по ключу. Локальный .env (ключи) копируется на сервер.
set -euo pipefail
TARGET="${1:?Использование: ./deploy/deploy.sh user@host [domain]}"
HOST_IP="${TARGET#*@}"
DOMAIN="${2:-${HOST_IP}.sslip.io}"
REPO="https://github.com/boboevproject-rgb/clarity-diagnostic-companion.git"
APP_DIR="clarity"

echo "→ Сервер: $TARGET, адрес: https://$DOMAIN"
ssh -o StrictHostKeyChecking=accept-new "$TARGET" "bash -s" <<REMOTE
set -euo pipefail
SUDO=""; [ "\$(id -u)" -ne 0 ] && SUDO="sudo"
if ! command -v docker >/dev/null 2>&1; then
  echo "→ Устанавливаю Docker"
  curl -fsSL https://get.docker.com | \$SUDO sh
fi
if ! command -v git >/dev/null 2>&1; then \$SUDO apt-get update -qq && \$SUDO apt-get install -y -qq git; fi
if [ -d "$APP_DIR/.git" ]; then git -C "$APP_DIR" pull --ff-only; else git clone "$REPO" "$APP_DIR"; fi
REMOTE

if [ -f .env ]; then
  echo "→ Копирую .env (ключи) на сервер"
  scp -q .env "$TARGET:$APP_DIR/.env"
fi

ssh "$TARGET" "cd $APP_DIR && SUDO=''; [ \"\$(id -u)\" -ne 0 ] && SUDO=sudo; \
  (command -v ufw >/dev/null && \$SUDO ufw status | grep -q active && \$SUDO ufw allow 80,443/tcp) || true; \
  DOMAIN=$DOMAIN \$SUDO -E docker compose -f deploy/docker-compose.prod.yml up -d --build && \
  \$SUDO docker compose -f deploy/docker-compose.prod.yml ps"

echo "✓ Готово: https://$DOMAIN (первая сборка 5–10 минут, сертификат HTTPS выдаётся автоматически)"
