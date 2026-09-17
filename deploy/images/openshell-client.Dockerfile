# Only the trusted forwarding services receive controller credentials.
FROM alpine:3.23@sha256:fd791d74b68913cbb027c6546007b3f0d3bc45125f797758156952bc2d6daf40
ARG TARGETARCH
RUN apk add --no-cache ca-certificates openssh-client lsof \
 && case "$TARGETARCH" in \
      arm64) arch=aarch64; checksum=7a949c48d1e000cd280869eea1e203e24816b9cfefc575b68a8b72b939cb3f43 ;; \
      amd64) arch=x86_64; checksum=4fb4476d80a1875a0b83547ec3aba999cf0a2e2d75f95f2f709b622e2103520e ;; \
      *) exit 1 ;; \
    esac \
 && wget -qO /tmp/cli.tgz "https://github.com/NVIDIA/OpenShell/releases/download/v0.0.116/openshell-${arch}-unknown-linux-musl.tar.gz" \
 && echo "$checksum  /tmp/cli.tgz" | sha256sum -c - \
 && tar -xzf /tmp/cli.tgz -C /usr/local/bin openshell \
 && rm /tmp/cli.tgz
ENTRYPOINT ["openshell"]
