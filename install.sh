#!/bin/sh
# Install CMA Office on a NEW Ubuntu VPS, behind a shared HTTPS proxy that can also serve other sites.
#
#   curl -fsSL https://raw.githubusercontent.com/timestodayit-eng/cma-office-repo/phase-1-backend-web/install.sh -o install.sh
#   sudo sh install.sh office.example.com                      (fresh, empty database)
#   sudo sh install.sh office.example.com cma-backup.sql.gz    (bring the old server's data)
#
# What it does:
#   1. installs Docker (if missing)
#   2. starts the shared proxy in ~/proxy (ports 80/443, HTTPS for every site)
#   3. downloads CMA Office into ~/cma-office and writes .env with new random passwords
#   4. (optional) loads a database backup from the old server
#   5. starts CMA Office and adds  <domain> -> CMA Office  to the proxy
# Safe to run again: an existing .env, proxy or site list is kept.
set -e
DOMAIN="$1"; BACKUP="$2"
REPO=https://github.com/timestodayit-eng/cma-office-repo.git
BRANCH=phase-1-backend-web
HOME_DIR="${SUDO_USER:+$(getent passwd "$SUDO_USER" | cut -d: -f6)}"; HOME_DIR="${HOME_DIR:-$HOME}"
APP="$HOME_DIR/cma-office"; PROXY="$HOME_DIR/proxy"

if [ -z "$DOMAIN" ]; then sed -n '2,16p' "$0"; exit 1; fi
case "$DOMAIN" in *[!a-zA-Z0-9.-]*) echo "Domain looks wrong: $DOMAIN"; exit 1;; esac
if [ -n "$BACKUP" ]; then BACKUP="$(cd "$(dirname "$BACKUP")" && pwd)/$(basename "$BACKUP")"; [ -f "$BACKUP" ] || { echo "Backup file not found: $2"; exit 1; }; fi
[ "$(id -u)" = 0 ] || { echo "Run with sudo:  sudo sh install.sh $*"; exit 1; }

echo "== 1/5 Docker"
command -v docker >/dev/null 2>&1 || curl -fsSL https://get.docker.com | sh
command -v git >/dev/null 2>&1 || (apt-get update -q && apt-get install -y -q git)
docker network inspect web >/dev/null 2>&1 || docker network create web

echo "== 2/5 Code"
if [ -d "$APP/.git" ]; then git -C "$APP" pull -q; else git clone -q -b "$BRANCH" "$REPO" "$APP"; fi

echo "== 3/5 Shared proxy ($PROXY)"
if [ ! -f "$PROXY/docker-compose.yml" ]; then mkdir -p "$PROXY" && cp -r "$APP/proxy/." "$PROXY/"; fi
if ! docker ps --format '{{.Names}}' | grep -qx proxy; then
  if ss -ltn 2>/dev/null | grep -qE ':(80|443) '; then
    echo "Something else already uses port 80/443 on this VPS. Stop it first (or ask for help)."; ss -ltnp | grep -E ':(80|443) '; exit 1
  fi
  (cd "$PROXY" && docker compose up -d)
fi

echo "== 4/5 Settings (.env)"
cd "$APP"
if [ ! -f .env ]; then
  cp .env.example .env
  sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=$(openssl rand -hex 24)|; s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -hex 32)|; s|^DOMAIN=.*|DOMAIN=$DOMAIN|" .env
  echo "Wrote $APP/.env with new passwords."
fi
grep -q '^PROXY_NETWORK=' .env || echo "PROXY_NETWORK=web" >> .env
sed -i "s|^DOMAIN=.*|DOMAIN=$DOMAIN|" .env
FILES="-f docker-compose.yml -f docker-compose.proxy.yml"

if [ -n "$BACKUP" ]; then
  echo "   Loading the old server's data from $BACKUP"
  docker compose $FILES up -d db
  until docker compose $FILES exec -T db pg_isready -U cma >/dev/null 2>&1; do sleep 2; done
  if [ "$(docker compose $FILES exec -T db psql -U cma -d cma -tAc "select count(*) from information_schema.tables where table_schema='public'")" != "0" ]; then
    echo "The database here already has data, so the backup was NOT loaded (nothing was overwritten)."
  else
    case "$BACKUP" in *.gz) gunzip -c "$BACKUP";; *) cat "$BACKUP";; esac | docker compose $FILES exec -T db psql -q -U cma -d cma >/dev/null
    echo "   Data loaded."
  fi
fi

echo "== 5/5 Start CMA Office (first build takes 5-10 minutes)"
docker compose $FILES up -d --build
sh "$PROXY/add-site.sh" "$DOMAIN" cma-office-web:3000

IP="$(curl -fsS4 https://api.ipify.org 2>/dev/null || hostname -I | cut -d' ' -f1)"
cat <<DONE

CMA Office is installed.
  * DNS: the domain's A record  $DOMAIN -> $IP  (if not done yet)
  * Then open  https://$DOMAIN   (first password for everyone: cma12345, unless you loaded old data)
  * Update later:        cd $APP && sh update.sh
  * Add another site:    sh $PROXY/add-site.sh <domain> <where>
DONE
