# syntax=docker/dockerfile:1.7
# Multi-stage build for the whole monorepo. Targets:
#   api  - Node.js API (planner, Google Maps integration, Postgres)
#   web  - nginx serving the React app and proxying /api to the API

ARG NODE_VERSION=22-alpine

# ---- Install all dependencies (cached on manifests only) ----
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund

# ---- Build + test everything ----
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages packages
COPY apps apps
RUN npm run build
RUN npm test -w @journey/api && npm test -w @journey/web

# ---- Production-only node_modules for the API ----
# Web dependencies are devDependencies (bundled by Vite), so they are skipped here.
FROM node:${NODE_VERSION} AS api-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --no-audit --no-fund

# ---- API runtime ----
FROM node:${NODE_VERSION} AS api
ENV NODE_ENV=production \
    PORT=4000 \
    HOST=0.0.0.0
WORKDIR /app
COPY --from=api-deps /app/node_modules ./node_modules
COPY package.json ./
COPY packages/shared/package.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY apps/api/package.json apps/api/
COPY --from=build /app/apps/api/dist apps/api/dist
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1
CMD ["node", "apps/api/dist/index.js"]

# ---- Web runtime ----
FROM nginx:1.29-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
