# CMA Office web + API. Runs on any Linux VPS: docker compose up -d --build
FROM node:22-alpine AS base
RUN corepack enable && apk add --no-cache openssl libc6-compat
WORKDIR /app

FROM base AS build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY apps/web/prisma apps/web/prisma
RUN pnpm install --frozen-lockfile
COPY . .
RUN cd apps/web && pnpm prisma generate && pnpm build

FROM base AS run
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
# Prisma CLI, schema and tsx for migrations and the seed on start
COPY --from=build /app/apps/web/prisma ./apps/web/prisma
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/web/node_modules ./apps/web/node_modules
COPY docker/start.sh /start.sh
RUN chmod +x /start.sh
EXPOSE 3000
CMD ["/start.sh"]
