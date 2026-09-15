import { run } from "../local/process.js";
import { allocatePorts, resolveInstallation } from "./resolve.js";
export async function doctorInstallation(configFile: string) {
  const resolved = await resolveInstallation(configFile, await allocatePorts());
  await run("docker", ["info", "--format", "{{.OSType}}"]);
  await run("docker", ["compose", "version"]);
  const images = [
    resolved.input.runtimeImage,
    resolved.input.companionImage,
    resolved.release.images.postgres,
    resolved.release.images.worker,
    resolved.release.images.relay,
    ...(resolved.input.browser
      ? [
          resolved.input.browser.image,
          resolved.input.browser.nodeImage,
          resolved.input.browser.egressImage,
          resolved.input.browser.dnsImage,
        ]
      : []),
  ];
  for (const image of images) await run("docker", ["image", "inspect", image]);
  return {
    state: "prerequisites_available",
    platform: `${process.platform}-${process.arch}`,
    release: resolved.release.version,
    images: images.length,
  };
}
