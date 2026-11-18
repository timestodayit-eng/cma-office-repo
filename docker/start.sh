#!/bin/sh
set -e
cd /app/apps/web
# Apply database changes, then seed (safe to re-run: existing users are not overwritten).
./node_modules/.bin/prisma migrate deploy
if [ "${SEED_ON_START:-1}" = "1" ]; then ./node_modules/.bin/tsx prisma/seed.ts || true; fi
exec node server.js
