# syntax=docker/dockerfile:1.7

# stage 1: build webui artifacts + staging dir via package script
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS builder
WORKDIR /repo
RUN --mount=type=cache,target=/root/.cache/node/corepack,sharing=locked \
    corepack enable && corepack prepare pnpm@10.28.2 --activate

# Fetch from the lockfile before copying source. This layer is reusable across
# source-only changes and is exported by the release workflow's BuildKit cache.
COPY pnpm-lock.yaml ./
RUN --mount=type=cache,target=/pnpm/store,sharing=locked \
    corepack pnpm@10.28.2 fetch --store-dir=/pnpm/store

COPY package.json pnpm-workspace.yaml ./
COPY apps/server apps/server
COPY apps/web apps/web
COPY apps/desktop/src/renderer/src/assets/fonts/Manrope-VariableFont_wght.ttf \
    apps/desktop/src/renderer/src/assets/fonts/Manrope-VariableFont_wght.ttf
COPY packages packages
COPY scripts scripts
COPY tsconfig.json tsconfig.node.json tsconfig.web.json tsconfig.desktop-renderer.json tsconfig.test.json ./
RUN --mount=type=cache,target=/pnpm/store,sharing=locked \
    CI=true pnpm install --offline --frozen-lockfile --store-dir=/pnpm/store
RUN pnpm --filter @mdcz/server build:webui
ARG MDCZ_RELEASE_VERSION=docker
RUN MDCZ_RELEASE_VERSION="${MDCZ_RELEASE_VERSION}" node scripts/package-server-webui.mjs --staging-only

# stage 2: install runtime deps inside the staging tree
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY --from=builder /repo/release/staging/mdcz-* /app/
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm install --omit=dev --no-audit --no-fund --no-package-lock

# stage 3: minimal runtime
FROM node:24-bookworm-slim
LABEL org.opencontainers.image.source="https://github.com/ShotHeadman/mdcz"
LABEL org.opencontainers.image.licenses="GPL-3.0-only"
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends gosu \
    && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app /app
COPY docker/server-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
ENV NODE_ENV=production \
    PORT=3838 \
    MDCZ_HOST=0.0.0.0 \
    MDCZ_HOME=/data \
    MDCZ_WEB_DIST_DIR=/app/web
# Fresh named volumes inherit the mountpoint's ownership from the image; without
# this, /data and /media are root-owned and the non-root runtime cannot write.
RUN mkdir -p /data /media && chown node:node /data /media
EXPOSE 3838
VOLUME /data
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
