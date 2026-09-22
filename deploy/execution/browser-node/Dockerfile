ARG OPENCLAW_IMAGE
FROM ${OPENCLAW_IMAGE}
LABEL io.clawscarf.browser-file-transfer="shared-artifacts-v1"
USER root
RUN install -d -o node -g node -m 0700 /state
COPY deploy/execution/browser-node/configuration.ts deploy/execution/browser-node/start.ts /opt/clawscarf/deploy/execution/browser-node/
RUN node --input-type=module -e "import fs from 'node:fs'; import {stripTypeScriptTypes} from 'node:module'; const p='/opt/clawscarf/deploy/execution/browser-node/configuration'; fs.writeFileSync(p+'.js',stripTypeScriptTypes(fs.readFileSync(p+'.ts','utf8'))); fs.unlinkSync(p+'.ts')"
COPY runtime/private-files.ts /opt/clawscarf/runtime/private-files.ts
RUN node --input-type=module -e "import fs from 'node:fs'; import {stripTypeScriptTypes} from 'node:module'; const p='/opt/clawscarf/runtime/private-files'; fs.writeFileSync(p+'.js',stripTypeScriptTypes(fs.readFileSync(p+'.ts','utf8'))); fs.unlinkSync(p+'.ts')"
COPY LICENSE THIRD_PARTY_NOTICES.md /usr/share/licenses/clawscarf-browser-node/
USER node
ENV HOME=/state OPENCLAW_STATE_DIR=/state/native OPENCLAW_CONFIG_PATH=/configuration/openclaw.json OPENCLAW_NO_RESPAWN=1 NODE_DISABLE_COMPILE_CACHE=1
WORKDIR /state
HEALTHCHECK NONE
STOPSIGNAL SIGTERM
ENTRYPOINT ["node", "/opt/clawscarf/deploy/execution/browser-node/start.ts"]
