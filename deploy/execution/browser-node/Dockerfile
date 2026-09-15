FROM ghcr.io/openclaw/openclaw:2026.9.4@sha256:cc596b846506a5f4cfcee111394a2725f375f01cca2ebb492a161fd1b747f101
USER root
RUN install -d -o node -g node -m 0700 /state
COPY deploy/execution/browser-node/configuration.ts deploy/execution/browser-node/start.ts /opt/clawscarf-browser-node/
RUN node --input-type=module -e "import fs from 'node:fs'; import {stripTypeScriptTypes} from 'node:module'; const p='/opt/clawscarf-browser-node/configuration'; fs.writeFileSync(p+'.js',stripTypeScriptTypes(fs.readFileSync(p+'.ts','utf8'))); fs.unlinkSync(p+'.ts')"
COPY LICENSE THIRD_PARTY_NOTICES.md /usr/share/licenses/clawscarf-browser-node/
USER node
ENV HOME=/state OPENCLAW_STATE_DIR=/state/native OPENCLAW_CONFIG_PATH=/configuration/openclaw.json OPENCLAW_NO_RESPAWN=1 NODE_DISABLE_COMPILE_CACHE=1
WORKDIR /state
HEALTHCHECK NONE
STOPSIGNAL SIGTERM
ENTRYPOINT ["node", "/opt/clawscarf-browser-node/start.ts"]
