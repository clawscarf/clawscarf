import assert from "node:assert/strict";
import { test } from "node:test";
import { observeEnrollmentConnection } from "../../services/access/providers/enrollment-observation.js";
import { OpenClawAuthority } from "../../services/access/providers/native.js";
import { NativeFailure } from "../../services/access/types/native-errors.js";

await test("enrollment observes delayed admission without replaying a mutation", async () => {
  let grants = 0,
    attempts = 0;
  await observeEnrollmentConnection(
    () => {
      grants++;
      return Promise.resolve();
    },
    () => {
      attempts++;
      return attempts === 1
        ? Promise.reject(new NativeFailure("access_denied"))
        : Promise.resolve();
    },
  );
  assert.equal(grants, 2);
  assert.equal(attempts, 2);
});
await test("enrollment stops when the acting administrator or selected grant no longer authorizes it", async () => {
  let grants = 0,
    attempts = 0;
  await assert.rejects(
    observeEnrollmentConnection(
      () => {
        grants++;
        return grants === 1
          ? Promise.resolve()
          : Promise.reject(new NativeFailure("access_denied"));
      },
      () => {
        attempts++;
        return Promise.reject(new NativeFailure("access_denied"));
      },
    ),
    { code: "access_denied" },
  );
  assert.equal(grants, 2);
  assert.equal(attempts, 1);
});
await test("persistent enrollment denial is bounded and cannot report readiness", async () => {
  let attempts = 0;
  await assert.rejects(
    observeEnrollmentConnection(
      () => Promise.resolve(),
      () => {
        attempts++;
        return Promise.reject(new NativeFailure("access_denied"));
      },
    ),
    { code: "access_denied" },
  );
  assert.equal(attempts, 12);
});

await test("ordinary administrator denial is never retried", async () => {
  let attempts = 0;
  const authority = new OpenClawAuthority("https://team.example", {
    connect: () => {
      attempts++;
      return Promise.reject(new NativeFailure("access_denied"));
    },
  });
  await assert.rejects(
    authority.verifyAdministrator(
      { identity: "clawscarf:actor", sessionHash: "session" },
      "credential",
    ),
    { code: "access_denied" },
  );
  assert.equal(attempts, 1);
});

await test("native reload unavailability never skips the administrator grant recheck", async () => {
  let grants = 0,
    attempts = 0;
  await observeEnrollmentConnection(
    () => {
      grants++;
      return grants === 1
        ? Promise.reject(new NativeFailure("unavailable"))
        : Promise.resolve();
    },
    () => {
      attempts++;
      return Promise.resolve();
    },
  );
  assert.equal(grants, 2);
  assert.equal(attempts, 1);
});
