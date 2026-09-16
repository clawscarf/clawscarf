FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       chromium=152.0.7977.82-1~deb12u1 chromium-sandbox=152.0.7977.82-1~deb12u1 \
    && rm -rf /var/lib/apt/lists/* \
    && install -d -o node -g node -m 0700 /state
COPY deploy/execution/browser/package*.json /opt/clawscarf/deploy/execution/browser/
RUN cd /opt/clawscarf/deploy/execution/browser && npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY deploy/execution/browser/start.ts deploy/execution/browser/discovery.ts /opt/clawscarf/deploy/execution/browser/
RUN node --input-type=module -e "import fs from 'node:fs'; import {stripTypeScriptTypes} from 'node:module'; const p='/opt/clawscarf/deploy/execution/browser/discovery'; fs.writeFileSync(p+'.js',stripTypeScriptTypes(fs.readFileSync(p+'.ts','utf8'))); fs.unlinkSync(p+'.ts')"
COPY deploy/execution/browser/LICENSE.* /usr/share/licenses/clawscarf-browser/
COPY runtime/private-files.ts /opt/clawscarf/runtime/private-files.ts
RUN node --input-type=module -e "import fs from 'node:fs'; import {stripTypeScriptTypes} from 'node:module'; const p='/opt/clawscarf/runtime/private-files'; fs.writeFileSync(p+'.js',stripTypeScriptTypes(fs.readFileSync(p+'.ts','utf8'))); fs.unlinkSync(p+'.ts')"
COPY LICENSE THIRD_PARTY_NOTICES.md /usr/share/licenses/clawscarf-browser/
USER node
ENV HOME=/tmp/browser-home XDG_CONFIG_HOME=/tmp/browser-home/config XDG_CACHE_HOME=/tmp/browser-home/cache
WORKDIR /state
EXPOSE 9223
STOPSIGNAL SIGTERM
ENTRYPOINT ["node", "/opt/clawscarf/deploy/execution/browser/start.ts"]
