FROM ghcr.io/openclaw/openclaw:2026.9.4@sha256:cc596b846506a5f4cfcee111394a2725f375f01cca2ebb492a161fd1b747f101 AS network-tools
USER root
COPY deploy/images/network-tools/build.sh /build-network-tools.sh
RUN sh /build-network-tools.sh

FROM scratch AS network-sources
COPY --from=network-tools /out/sources/ /
COPY deploy/images/network-tools/build.sh /build.sh

FROM node:24.19.0-bookworm@sha256:4196d66a565c6f195728d9952f161f4adfe2ad753052a08b7ec7f1c5a6bda42b

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       openssh-server=1:9.2p1-2+deb12u10 python3=3.11.2-1+b1 \
       iproute2=6.1.0-3 libmnl0=1.0.4-3 \
       libgmp10=2:6.2.1+dfsg1-1.1 libjansson4=2.14-2 \
       tar=1.34+dfsg-1.2+deb12u1 coreutils=9.1-1 \
    && rm -rf /var/lib/apt/lists/* /etc/ssh/ssh_host_* \
    && install -d -m 0755 /run/sshd \
    && install -d -o node -g node -m 0700 /home/node/.clawscarf-worker \
    && install -d -o node -g node -m 0755 /workspace \
    && passwd -d node
COPY --from=network-tools /out/runtime/ /
COPY deploy/execution/worker/sshd_config /etc/ssh/clawscarf_sshd_config
COPY LICENSE THIRD_PARTY_NOTICES.md /usr/share/licenses/clawscarf/

USER node
WORKDIR /workspace
EXPOSE 2222
CMD ["/usr/sbin/sshd", "-D", "-e", "-f", "/etc/ssh/clawscarf_sshd_config"]
