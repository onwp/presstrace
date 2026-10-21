# syntax=docker/dockerfile:1

# Exact version and digest, so every build uses the same base image. Dependabot proposes updates.
FROM node:24.22.0-alpine3.24@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json vite.config.ts ./
COPY src ./src
RUN pnpm run build

FROM node:24.22.0-alpine3.24@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS runtime
LABEL org.opencontainers.image.title="PressTrace" \
      org.opencontainers.image.description="Self-hosted APM app for WordPress: ingest API and dashboard." \
      org.opencontainers.image.source="https://github.com/onwp/presstrace" \
      org.opencontainers.image.url="https://onwp.github.io/presstrace/" \
      org.opencontainers.image.documentation="https://onwp.github.io/presstrace/" \
      org.opencontainers.image.licenses="LicenseRef-PolyForm-Strict-1.0.0"
# The V8 heap limit follows the container memory limit (75% of it).
ENV NODE_ENV=production \
    PORT=8080 \
    WEB_ROOT=/app/dist/web \
    NODE_OPTIONS=--max-old-space-size-percentage=75
WORKDIR /app
# Security fixes for the Alpine packages released after the pinned base image, and no package managers at
# runtime: npm, npx, corepack and yarn are never used by the app and only add code (and CVEs) to the image.
RUN apk upgrade --no-cache \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-v* \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
# The server is bundled into one file, so no node_modules are needed at runtime.
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server/index.js"]
