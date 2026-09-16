import { open, readFile, unlink } from "node:fs/promises";
import { z } from "zod";
import { Agent, fetch } from "undici";
import { type ModelConfiguration } from "./configuration.js";
export async function issueRuntimeCredential(input: {
  origin: string;
  masterKeyFile: string;
  output: string;
  configuration: ModelConfiguration;
  caFile?: string;
}) {
  if (input.configuration.mode !== "litellm")
    throw Error("Key provisioning requires bundled LiteLLM mode.");
  const client = await managementClient(input);
  const output = await open(input.output, "wx", 0o600).catch(
    async (error: unknown) => {
      await client.close();
      throw error;
    },
  );
  let stored = false;
  let cleanup: PromiseSettledResult<unknown>[];
  try {
    const response = await client.request("/key/generate", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: {
        Authorization: `Bearer ${client.masterKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        models: input.configuration.models
          .filter((model) => model.enabled)
          .map((model) => model.id),
        key_type: "llm_api",
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw Error("LiteLLM credential provisioning was rejected.");
    }
    const body: unknown = await response.json();
    const result = z.object({ key: z.string().startsWith("sk-") }).parse(body);
    await output.writeFile(`${result.key}\n`);
    await output.sync();
    stored = true;
  } finally {
    cleanup = await Promise.allSettled([
      output.close(),
      client.close(),
      ...(!stored ? [unlink(input.output)] : []),
    ]);
  }
  if (cleanup.some((result) => result.status === "rejected"))
    throw Error("Runtime key was stored, but local credential cleanup failed.");
}

export async function revokeRuntimeCredential(input: {
  origin: string;
  masterKeyFile: string;
  keyFile: string;
  caFile?: string;
}) {
  const key = (await readFile(input.keyFile, "utf8")).trim();
  const client = await managementClient(input);
  try {
    if (!key.startsWith("sk-") || key === client.masterKey)
      throw Error("Supply distinct administrator and runtime credentials.");
    const response = await client.request("/key/delete", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: {
        Authorization: `Bearer ${client.masterKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ keys: [key] }),
    });
    await response.body?.cancel();
    if (!response.ok)
      throw Error("LiteLLM credential revocation was rejected.");
  } finally {
    await client.close();
  }
}

async function managementClient(input: {
  origin: string;
  masterKeyFile: string;
  caFile?: string;
}) {
  const origin = new URL(input.origin);
  if (
    origin.origin !== input.origin ||
    origin.username ||
    origin.password ||
    !["http:", "https:"].includes(origin.protocol)
  )
    throw Error("Use the private LiteLLM management origin.");
  const masterKey = (await readFile(input.masterKeyFile, "utf8")).trim();
  if (!masterKey.startsWith("sk-"))
    throw Error("Invalid LiteLLM management credential.");
  const dispatcher = input.caFile
    ? new Agent({ connect: { ca: await readFile(input.caFile, "utf8") } })
    : undefined;
  return {
    masterKey,
    request: (path: string, options: Parameters<typeof fetch>[1]) =>
      fetch(new URL(path, origin), {
        ...options,
        ...(dispatcher ? { dispatcher } : {}),
      }),
    close: async () => {
      await dispatcher?.close();
    },
  };
}
