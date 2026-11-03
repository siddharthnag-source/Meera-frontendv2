const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const { NextRequest, NextResponse } = require("next/server");
const source = fs.readFileSync(
  "src/app/api/onboarding/session/route.ts",
  "utf8",
);
function harness(options = {}) {
  const calls = [];
  const env = {
    ONBOARDING_ALLOWED_ORIGIN: "https://onboarding.example",
    GEMINI_API_KEY: "staging-fixture",
    TURNSTILE_SECRET_KEY: "challenge-fixture",
    GEMINI_ONBOARDING_MODEL: "test-native-audio",
    ...options.env,
  };
  const config = { systemInstruction: "locked onboarding prompt" };
  const module = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      exports: module.exports,
      module,
      process: { env },
      URL,
      URLSearchParams,
      AbortSignal,
      Date,
      TextDecoder,
      Uint8Array,
      require(name) {
        if (name === "next/server") return { NextResponse };
        if (name === "@/lib/onboarding-agent")
          return { onboardingConfig: () => config };
        if (name === "@google/genai")
          return {
            GoogleGenAI: class {
              constructor(settings) {
                calls.push(["client", settings]);
              }
              authTokens = {
                create: async (request) => {
                  calls.push(["token", request]);
                  if (options.tokenError)
                    throw Error("private provider detail");
                  return options.noToken ? {} : { name: "auth_tokens/test" };
                },
              };
            },
          };
        throw Error(`Unexpected import ${name}`);
      },
      fetch: async (url, init) => {
        calls.push(["verification", url, init]);
        if (options.fetchError) throw Error("secret network detail");
        return {
          ok: true,
          json: async () => ({
            success: true,
            hostname: "onboarding.example",
            action: "onboarding",
            ...options.verification,
          }),
        };
      },
    },
  );
  async function request(
    body = { challenge: "one-use-challenge" },
    origin = "https://onboarding.example",
    headers = {},
  ) {
    return module.exports.POST(
      new NextRequest("https://onboarding.example/api/onboarding/session", {
        method: "POST",
        headers: { origin, "content-type": "application/json", ...headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
  }
  return { request, calls, config };
}
test("rejects foreign and missing origins without upstream requests", async () => {
  const h = harness();
  assert.equal((await h.request({}, "https://attacker.example")).status, 403);
  assert.equal((await h.request({}, "")).status, 403);
  assert.equal(h.calls.length, 0);
});
test("missing credentials fail closed, with no upstream request", async () => {
  for (const key of [
    "GEMINI_API_KEY",
    "TURNSTILE_SECRET_KEY",
    "GEMINI_ONBOARDING_MODEL",
  ]) {
    const h = harness({ env: { [key]: "" } });
    const response = await h.request();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(h.calls.length, 0);
  }
});
test("invalid JSON, null, and absent or invalid challenge are rejected", async () => {
  for (const body of [
    "{",
    "null",
    {},
    { challenge: "" },
    { challenge: 12 },
    { challenge: "a".repeat(2049) },
  ]) {
    const h = harness();
    assert.equal((await h.request(body)).status, 400);
    assert.equal(h.calls.length, 0);
  }
});
test("rejects oversized payloads with and without a content-length header", async () => {
  for (const headers of [{}, { "content-length": "5000" }]) {
    const h = harness();
    assert.equal(
      (await h.request({ challenge: "a".repeat(5000) }, undefined, headers))
        .status,
      413,
    );
    assert.equal(h.calls.length, 0);
  }
});
for (const [label, verification] of [
  ["expired challenge", { success: false }],
  ["wrong host", { hostname: "attacker.example" }],
  ["wrong action", { action: "login" }],
]) {
  test(`rejects ${label} before minting a token`, async () => {
    const h = harness({ verification });
    assert.equal((await h.request()).status, 403);
    assert.equal(h.calls.length, 1);
  });
}
test("mints only a single-use constrained five-minute ephemeral token", async () => {
  const h = harness();
  const before = Date.now();
  const response = await h.request();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    token: "auth_tokens/test",
    model: "test-native-audio",
  });
  const config = h.calls.find((call) => call[0] === "token")[1].config;
  assert.equal(config.uses, 1);
  assert.equal(config.liveConnectConstraints.config, h.config);
  assert.equal(config.liveConnectConstraints.model, "test-native-audio");
  assert.ok(Date.parse(config.expireTime) - before <= 300100);
  assert.ok(Date.parse(config.newSessionExpireTime) - before <= 60100);
  assert.equal(response.headers.get("cache-control"), "no-store");
});
for (const options of [
  { fetchError: true },
  { tokenError: true },
  { noToken: true },
]) {
  test(`provider failure is safe: ${JSON.stringify(options)}`, async () => {
    const h = harness(options);
    const response = await h.request();
    assert.equal(response.status, 502);
    assert.doesNotMatch(
      await response.text(),
      /private provider detail|secret network detail|staging-fixture/,
    );
  });
}
