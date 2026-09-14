import assert from "node:assert/strict";
import { test } from "node:test";
import { GatewayClientRequestError } from "@openclaw/gateway-client";
import { isAccessDenied } from "../../services/access/providers/gateway.js";

await test("vendor text, lookalike fields and locally constructed SDK errors cannot impersonate a correlated authorization denial", () => {
  for (const error of [
    new Error("FORBIDDEN AUTH_UNAUTHORIZED"),
    { gatewayCode: "FORBIDDEN" },
    Object.assign(new Error("access_denied"), {
      name: "GatewayProtocolRequestError",
      gatewayCode: "FORBIDDEN",
      details: { reason: "websocket-upgrade-rejected", httpStatus: 403 },
    }),
    new GatewayClientRequestError({
      code: "FORBIDDEN",
      details: { code: "AUTH_UNAUTHORIZED" },
    }),
  ]) {
    assert.equal(isAccessDenied(error), false);
  }
});
