# syntax=docker/dockerfile:1.7

# stage 1: build webui artifacts + staging dir via package script
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS builder
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server apps/server
COPY apps/web apps/web
COPY packages packages
COPY scripts scripts
COPY tsconfig.json tsconfig.node.json tsconfig.web.json tsconfig.desktop-renderer.json tsconfig.test.json ./
RUN pnpm install --frozen-lockfile
RUN pnpm build:webui
ARG MDCZ_RELEASE_VERSION=docker
RUN MDCZ_RELEASE_VERSION="${MDCZ_RELEASE_VERSION}" node scripts/package-server-webui.mjs --staging-only

# stage 2: install runtime deps inside the staging tree
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY --from=builder /repo/release/staging/mdcz-* /app/
RUN npm install --omit=dev --no-audit --no-fund --no-package-lock

# stage 3: minimal runtime
FROM node:24-bookworm-slim
LABEL org.opencontainers.image.source="https://github.com/ShotHeadman/mdcz"
LABEL org.opencontainers.image.licenses="GPL-3.0-only"
WORKDIR /app
COPY --from=deps /app /app
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
USER node
CMD ["node", "server.js"]
