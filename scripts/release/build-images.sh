#!/usr/bin/env bash
# CI-only image build. GITHUB_TOKEN registry login belongs to the workflow.
set -euo pipefail
: "${GITHUB_REPOSITORY:?}" "${GITHUB_SHA:?}" "${GITHUB_RUN_ID:?}"
output="${1:?output directory}"
mkdir -p "$output"
revision="$(jq -er '.openclaw.sourceRevision' release/components.json)"
base="$(jq -er '.openclaw.image' release/components.json)"
node="$(jq -er '.companionNode.image' release/components.json)"
upstream="$output/upstream"
git init "$upstream"
git -C "$upstream" remote add origin https://github.com/openclaw/openclaw.git
git -C "$upstream" fetch --depth=1 origin "$revision"
git -C "$upstream" checkout --detach FETCH_HEAD
test "$(git -C "$upstream" rev-parse HEAD)" = "$revision"
docker build --build-arg "GIT_COMMIT=$revision" \
  --build-arg "OPENCLAW_BUILD_TIMESTAMP=$(git -C "$upstream" show -s --format=%cI HEAD)" \
  --build-arg OPENCLAW_EXTENSIONS=codex -t "$base" "$upstream"
rm -rf "$upstream"
echo '{}' > "$output/images.json"
while read -r name dockerfile; do
  image="ghcr.io/${GITHUB_REPOSITORY,,}/$name:build-$GITHUB_RUN_ID"
  docker build --label "org.opencontainers.image.source=https://github.com/$GITHUB_REPOSITORY" \
    --label "org.opencontainers.image.revision=$GITHUB_SHA" \
    --build-arg "OPENCLAW_IMAGE=$base" --build-arg "NODE_IMAGE=$node" \
    -f "$dockerfile" -t "$image" .
  if [[ "$name" == runtime ]]; then
    docker run --rm --network none --read-only --tmpfs /tmp:rw,size=256m \
      --entrypoint node -v "$PWD/tests/runtime/capabilities.mjs:/tmp/check.mjs:ro" "$image" /tmp/check.mjs
  fi
  if [[ "$name" == browser ]]; then
    CLAWSCARF_TEST_BROWSER_IMAGE="$image" node --import tsx --test tests/runtime/browser.test.ts
  fi
  docker push "$image"
  digest="$(docker image inspect "$image" --format '{{index .RepoDigests 0}}')"
  jq --arg name "$name" --arg image "$digest" '. + {($name): $image}' "$output/images.json" > "$output/images.tmp"
  mv "$output/images.tmp" "$output/images.json"
done <<'IMAGES'
runtime deploy/images/Dockerfile
companion deploy/images/companion.Dockerfile
openshell-client deploy/images/openshell-client.Dockerfile
browser deploy/execution/browser/Dockerfile
browser-node deploy/execution/browser-node/Dockerfile
browser-dns deploy/execution/dns/Dockerfile
browser-egress deploy/execution/network/Dockerfile.egress
browser-relay deploy/execution/network/Dockerfile.relay
IMAGES
# Retain the corresponding network-tool source offer with the binary release.
docker build -f deploy/images/Dockerfile --target network-sources --output "type=local,dest=$output/network-sources" .
tar -czf "$output/network-sources.tgz" -C "$output/network-sources" .
rm -rf "$output/network-sources"
