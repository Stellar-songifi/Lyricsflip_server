# Multi-stage build for the LyricsFlip NestJS API.
#
# Stage 1 installs all dependencies (including dev) and compiles TypeScript.
# Stage 2 ships only production dependencies and runs as a non-root user.

# ---- Build stage ----
FROM node:20-alpine AS build

WORKDIR /app

# Install dependencies first so this layer is cached when only source changes.
COPY package.json package-lock.json ./
RUN npm ci

# Copy sources and compile.
COPY . .
RUN npm run build

# ---- Runtime stage ----
FROM node:20-alpine AS runtime

ENV NODE_ENV=production
# main.ts listens on HOST (default localhost), which is unreachable from
# outside a container; bind every interface instead.
ENV HOST=0.0.0.0

WORKDIR /app

# Install production dependencies only.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy the compiled output (including dist/data-source.js and dist/migrations)
# and the entrypoint that waits for the database and optionally migrates.
COPY --from=build /app/dist ./dist
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Run as a non-root user.
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

EXPOSE 3000

# Liveness probe: /health/live is outside the api/v1 prefix (see main.ts).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health/live').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["./docker-entrypoint.sh"]
# docker-entrypoint.sh finds the compiled main.js itself: tsconfig.json also
# compiles typeorm.config.ts, so tsc emits it under dist/src/.
CMD ["node-main"]
