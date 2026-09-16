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
  const url = new URL(input.origin);
  if (
    url.origin !== input.origin ||
    url.username ||
    url.password ||
    !["http:", "https:"].includes(url.protocol)
  )
    throw Error("Use the private LiteLLM management origin.");
  const masterKey = (await readFile(input.masterKeyFile, "utf8")).trim();
  if (!masterKey.startsWith("sk-"))
    throw Error("Invalid LiteLLM management credential.");
  const ca = input.caFile ? await readFile(input.caFile, "utf8") : undefined;
  const output = await open(input.output, "wx", 0o600);
  const dispatcher = ca ? new Agent({ connect: { ca } }) : undefined;
  let stored = false;
  try {
    const response = await fetch(new URL("/key/generate", input.origin), {
      ...(dispatcher ? { dispatcher } : {}),
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: {
        Authorization: `Bearer ${masterKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        models: input.configuration.models
          .filter((model) => model.enabled)
          .map((model) => model.id),
        key_type: "llm_api",
      }),
    });
    if (!response.ok)
      throw Error("LiteLLM credential provisioning was rejected.");
    const body: unknown = await response.json();
    const result = z.object({ key: z.string().startsWith("sk-") }).parse(body);
    await output.writeFile(`${result.key}\n`);
    await output.sync();
    stored = true;
  } finally {
    await output.close();
    await dispatcher?.close();
    if (!stored) await unlink(input.output);
  }
}

export async function revokeRuntimeCredential(input: {
  origin: string;
  masterKeyFile: string;
  keyFile: string;
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
  const key = (await readFile(input.keyFile, "utf8")).trim();
  if (
    !masterKey.startsWith("sk-") ||
    !key.startsWith("sk-") ||
    key === masterKey
  )
    throw Error("Supply distinct administrator and runtime credentials.");
  const response = await fetch(new URL("/key/delete", origin), {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(30000),
    headers: {
      Authorization: `Bearer ${masterKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ keys: [key] }),
  });
  if (!response.ok) throw Error("LiteLLM credential revocation was rejected.");
}
