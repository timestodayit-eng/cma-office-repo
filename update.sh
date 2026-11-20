#!/bin/sh
# Update CMA Office on the server: get the new code and rebuild, served the same way as before.
# Usage:  sh update.sh
set -e
cd "$(dirname "$0")"
git pull
if grep -q '^PROXY_NETWORK=' .env 2>/dev/null; then
  FILES="-f docker-compose.yml -f docker-compose.proxy.yml"   # behind the existing Caddy (HTTPS)
elif docker port cma-office-web-1 3000 >/dev/null 2>&1; then
  FILES="-f docker-compose.yml -f docker-compose.direct.yml"  # plain port 3000
else
  FILES="-f docker-compose.yml"
fi
docker compose $FILES up -d --build
docker image prune -f >/dev/null
echo "CMA Office updated."
