import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

const origin = process.env.CLAWSCARF_TEST_HOOK_ORIGIN;
const tokenFile = process.env.CLAWSCARF_TEST_HOOK_TOKEN_FILE;
const widgetOrigin = process.env.CLAWSCARF_TEST_WIDGET_ORIGIN;

await test(
  "native authenticated hook on team HTTPS ingress preserves its own authorization",
  { skip: !origin || !tokenFile || !widgetOrigin, timeout: 30000 },
  async () => {
    assert.ok(origin && tokenFile && widgetOrigin);
    for (const value of [origin, widgetOrigin]) {
      const url = new URL(value);
      assert.equal(url.protocol, "https:");
      assert.equal(url.origin, value);
    }
    assert.notEqual(origin, widgetOrigin);
    const token = (await readFile(tokenFile, "utf8")).trim();
    assert.ok(token);
    async function request(
      path: string,
      method: "GET" | "POST",
      credential?: string,
      target = origin,
    ) {
      const response = await fetch(target + path, {
        method,
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
        headers: {
          "content-type": "application/json",
          ...(credential ? { authorization: `Bearer ${credential}` } : {}),
          cookie: "clawscarf_session=untrusted-test-value",
          "x-openclaw-user": "forged-administrator",
          "x-clawscarf-user": "forged-administrator",
        },
        ...(method === "POST"
          ? {
              body: JSON.stringify({
                text: "ClawScarf native hook acceptance",
                mode: "next-heartbeat",
              }),
            }
          : {}),
      });
      await response.body?.cancel();
      return response.status;
    }
    assert.equal(await request("/hooks/wake", "POST"), 401);
    assert.equal(await request("/hooks/wake", "POST", "invalid-token"), 401);
    assert.equal(await request("/hooks/wake", "POST", token), 200);
    for (const [path, method] of [
      ["/hooks/wake", "GET"],
      ["/hooks/agent", "POST"],
      ["/hooks/wake/extra", "POST"],
    ] as const)
      assert.equal(await request(path, method, token), 401);
    assert.equal(
      await request("/_clawscarf/session", "GET", token, widgetOrigin),
      403,
    );
  },
);
