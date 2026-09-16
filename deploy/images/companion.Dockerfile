# Supply an exact approved image reference; no implicit latest dependency.
ARG NODE_IMAGE
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml tsconfig*.json ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY services ./services
COPY generated/http ./generated/http
COPY apps ./apps
COPY ui ./ui
COPY scripts/build-companion.ts ./scripts/build-companion.ts
COPY scripts/release/dependencies.ts scripts/release/runtime-package.ts ./scripts/release/
RUN pnpm exec tsc -b tsconfig.sdk.json && pnpm exec tsc -p tsconfig.build.json \
 && pnpm exec vite build --config services/access/web/vite.config.ts \
 && pnpm exec vite build --config services/connections/web/vite.config.ts \
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
COPY --from=build /app/services/access/dist/web ./services/access/dist/web
COPY --from=build /app/services/connections/dist/web ./services/connections/dist/web
COPY services/access/openapi.json ./services/access/openapi.json
COPY services/access/migrations ./services/access/migrations
COPY services/connections/openapi.json ./services/connections/openapi.json
COPY services/connections/migrations ./services/connections/migrations
COPY LICENSE THIRD_PARTY_NOTICES.md /usr/share/licenses/clawscarf/
COPY ui/shadcn/LICENSE.md /usr/share/licenses/clawscarf/shadcn-MIT.txt
USER node
ENV NODE_ENV=production
EXPOSE 18800
CMD ["node", "apps/companion/entry.js"]
