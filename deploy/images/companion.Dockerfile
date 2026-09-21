# Supply an exact approved image reference; no implicit latest dependency.
ARG NODE_IMAGE
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml tsconfig*.json ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY services ./services
COPY generated/http ./generated/http
COPY apps ./apps
COPY scripts/build-companion.ts ./scripts/build-companion.ts
COPY scripts/release/dependencies.ts scripts/release/runtime-package.ts ./scripts/release/
RUN pnpm exec tsc -b tsconfig.sdk.json && pnpm exec tsc -p tsconfig.build.json \
 && node --import tsx scripts/build-companion.ts

FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app
COPY --from=build /app/dist/package.json /app/dist/pnpm-lock.yaml ./
RUN corepack enable && pnpm install --prod --frozen-lockfile

FROM ${NODE_IMAGE}
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist/package.json ./package.json
COPY --from=build /app/dist/services ./services
COPY --from=build /app/dist/generated/http ./generated/http
COPY generated/http/LICENSE.md ./generated/http/LICENSE.md
COPY --from=build /app/dist/apps ./apps
COPY services/access/openapi.json ./services/access/openapi.json
COPY services/access/migrations ./services/access/migrations
COPY services/connections/cloud/openapi.json ./services/connections/cloud/openapi.json
COPY LICENSE THIRD_PARTY_NOTICES.md /usr/share/licenses/clawscarf/
USER node
ENV NODE_ENV=production
EXPOSE 18800
CMD ["node", "apps/companion/entry.js"]
