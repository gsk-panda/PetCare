# One image serving both halves of the product: the built SPA and the API that
# feeds it, on a single origin. That is not just tidiness -- the session
# cookies are sameSite=lax, so same-origin is what lets the deployed app behave
# exactly like the dev proxy instead of subtly differently.

FROM node:22-alpine AS deps
WORKDIR /app
# Manifests first: this layer only rebuilds when dependencies actually change.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build -w @petcare/web

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --omit=dev

# @petcare/shared is published as TypeScript source rather than build output,
# so the runtime needs the source and tsx to load it.
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY --from=build /app/apps/web/dist apps/web/dist

USER node
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# node as PID 1 rather than `npm start`, so SIGTERM reaches the app and the
# graceful shutdown in index.ts actually runs.
CMD ["node", "--import", "tsx", "apps/api/src/index.ts"]
