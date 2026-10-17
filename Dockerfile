# syntax=docker/dockerfile:1.7
# Pin NODE_IMAGE to a reviewed digest in the release pipeline.
ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE} AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund

# Separate, one-off image. Never run migrations in each web replica's entrypoint.
# Build with --target migrations and use a reviewed direct/session DB connection.
FROM dependencies AS migrations
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node tsconfig.json ./tsconfig.json
ENV NODE_ENV=production DEMO_MODE=false
USER node
CMD ["npm", "run", "db:migrate"]

FROM dependencies AS builder
COPY . .
ARG DEPLOYMENT_VERSION
ARG NEXT_ASSET_PREFIX=""
ENV NODE_ENV=production DEMO_MODE=false
ENV DEPLOYMENT_VERSION=${DEPLOYMENT_VERSION}
ENV NEXT_ASSET_PREFIX=${NEXT_ASSET_PREFIX}
RUN test -n "$DEPLOYMENT_VERSION" && mkdir -p public
# There are no Server Actions today. If added, provide a stable build-only secret
# with --secret id=next_server_actions_key,src=/secure/key; never use ARG for it.
RUN --mount=type=secret,id=next_server_actions_key \
    if [ -f /run/secrets/next_server_actions_key ]; then \
      export NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="$(cat /run/secrets/next_server_actions_key)"; \
    fi; \
    npm run build

FROM base AS runner
ARG DEPLOYMENT_VERSION
ENV NODE_ENV=production DEMO_MODE=false PORT=3000 HOSTNAME=0.0.0.0
ENV DEPLOYMENT_VERSION=${DEPLOYMENT_VERSION}
LABEL org.opencontainers.image.revision=${DEPLOYMENT_VERSION}
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
RUN mkdir -p /app/.next/cache && chown node:node /app/.next/cache
USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
