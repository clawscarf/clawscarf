FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends unbound=1.17.1-2+deb12u4 \
    && rm -rf /var/lib/apt/lists/*
COPY deploy/execution/dns/unbound.conf /etc/unbound/clawscarf.conf
COPY LICENSE THIRD_PARTY_NOTICES.md /usr/share/licenses/clawscarf-browser-dns/
USER unbound
EXPOSE 53/udp 53/tcp
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/sbin/unbound", "-d", "-c", "/etc/unbound/clawscarf.conf"]
