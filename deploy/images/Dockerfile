ARG OPENCLAW_IMAGE=clawscarf-openclaw:7bc487d39dc9e059bb9b19ea08152883022f83fe
FROM ${OPENCLAW_IMAGE} AS upstream

FROM upstream AS network-tools
USER root
COPY deploy/images/network-tools/build.sh /build-network-tools.sh
RUN sh /build-network-tools.sh

FROM scratch AS network-sources
COPY --from=network-tools /out/sources/ /
COPY deploy/images/network-tools/build.sh /build.sh

FROM upstream AS connections
USER root
WORKDIR /build/plugins/connections
COPY plugins/connections/ ./
COPY services/connections/cloud/generated/ /build/services/connections/cloud/generated/
COPY services/access/generated/ /build/services/access/generated/
COPY ui/native-page.ts /build/ui/native-page.ts
COPY generated/http/ /build/generated/http/
RUN npm ci --include=dev --ignore-scripts --no-audit --no-fund \
    && npm run artifact \
    && mkdir /out \
    && tar -xzf .local/artifact/connectors.tgz --strip-components=1 -C /out

FROM upstream AS native-plugins
USER root
WORKDIR /build/native-plugins
COPY deploy/images/native-plugins/download.mjs deploy/images/native-plugins/lobster.json ./
RUN node download.mjs \
    && mkdir -p node_modules/@openclaw/lobster \
    && tar -xzf /tmp/lobster.tgz --strip-components=1 -C node_modules/@openclaw/lobster \
    && rm /tmp/lobster.tgz download.mjs \
    && ln -s /app node_modules/openclaw

FROM upstream AS access
USER root
WORKDIR /build/plugins/access
COPY plugins/access/ ./
COPY ui/native-page.ts /build/ui/native-page.ts
COPY services/access/generated/ /build/services/access/generated/
COPY generated/http/ /build/generated/http/
RUN npm ci --include=dev --ignore-scripts --no-audit --no-fund \
    && npm run build \
    && mkdir /out \
    && cp -r dist openclaw.plugin.json package.json LICENSE README.md /out

FROM upstream AS pack-tools
USER root
WORKDIR /build/pack-tools
COPY deploy/images/pack-tools/ ./
RUN npm ci --include=dev --ignore-scripts --no-audit --no-fund
COPY scripts/packs.ts scripts/output.ts ./scripts/
COPY scripts/packs/ ./scripts/packs/
COPY services/connections/generated/ ./services/connections/generated/
COPY generated/http/ ./generated/http/
RUN ./node_modules/.bin/tsc -p tsconfig.json \
    && npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM upstream AS runtime-tools
USER root
WORKDIR /build/runtime-tools
COPY deploy/images/pack-tools/package*.json ./
RUN npm ci --include=dev --ignore-scripts --no-audit --no-fund
COPY runtime/private-files.ts runtime/models.ts runtime/models-main.ts runtime/model-contract.ts runtime/initialize.ts runtime/initialize-main.ts runtime/initialize-worker.ts runtime/initialize-worker-main.ts runtime/initialize-browser.ts runtime/initialize-browser-main.ts runtime/trust.ts runtime/trust-main.ts runtime/connections-credential.ts runtime/connections-credential-main.ts runtime/connections-configuration.ts runtime/configure-connections.ts runtime/configure-connections-main.ts runtime/start-gate.ts runtime/start-gate-main.ts ./
RUN ./node_modules/.bin/tsc --target ES2024 --module NodeNext --types node --strict --skipLibCheck --outDir /out models.ts models-main.ts model-contract.ts initialize.ts initialize-main.ts initialize-worker.ts initialize-worker-main.ts initialize-browser.ts initialize-browser-main.ts trust.ts trust-main.ts connections-credential.ts connections-credential-main.ts connections-configuration.ts configure-connections.ts configure-connections-main.ts start-gate.ts start-gate-main.ts

FROM upstream
LABEL io.clawscarf.start-gate="1"

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends iproute2=6.1.0-3 \
       libmnl0=1.0.4-3 libgmp10=2:6.2.1+dfsg1-1.1 libjansson4=2.14-2 \
       chromium=152.0.7977.82-1~deb12u1 chromium-sandbox=152.0.7977.82-1~deb12u1 \
    && rm -rf /var/lib/apt/lists/* \
    && install -d -o node -g node -m 0700 /home/node/.openclaw \
    && install -d -o node -g node -m 0755 /workspace
COPY --from=connections /out /app/clawscarf/connections
RUN ln -s /app /app/clawscarf/connections/node_modules/openclaw
COPY --from=network-tools /out/runtime/ /
COPY --from=native-plugins /build/native-plugins /app/clawscarf/native-plugins
COPY --from=access /out /app/clawscarf/access
COPY --chmod=0755 runtime/openclaw.sh /app/clawscarf/bin/openclaw
COPY --from=runtime-tools /build/runtime-tools/node_modules/zod /app/clawscarf/node_modules/zod
COPY --from=runtime-tools /out/ /app/clawscarf/
COPY release/licenses/ /usr/share/licenses/clawscarf/
COPY LICENSE THIRD_PARTY_NOTICES.md /usr/share/licenses/clawscarf/

COPY --from=pack-tools /build/pack-tools/dist /app/clawscarf/pack-tools
COPY --from=pack-tools /build/pack-tools/node_modules /app/clawscarf/pack-tools/node_modules
COPY --from=pack-tools /build/pack-tools/package.json /app/clawscarf/pack-tools/package.json
COPY packs/research-team/ /app/clawscarf/packs/research-team/
COPY --chmod=0755 runtime/packs.sh /app/clawscarf/bin/packs

USER node
ENV SQLITE_TMPDIR=/tmp
WORKDIR /workspace
# OpenShell owns the outer container; probe Gateway inside its application namespace.
HEALTHCHECK NONE
CMD ["/app/clawscarf/bin/openclaw", "gateway"]
