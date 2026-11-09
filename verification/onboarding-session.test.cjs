const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { NextRequest } = require("next/server");
function harness(options = {}) {
  const calls = [],
    cache = new Map();
  const draft = { profile: { name: "Arya" }, revision: 0, complete: false };
  const user = {
    id: "verified-user",
    email_confirmed_at: "2026-11-04",
    identities: [{ provider: "google" }],
    user_metadata: { full_name: "Arya" },
    ...options.user,
  };
  const db = {
    auth: {
      getUser: async (token) => {
        calls.push(["identity", token]);
        return { data: { user: options.noUser ? null : user }, error: null };
      },
    },
    rpc: async (name, args) => {
      calls.push(["rpc", name, args]);
      if (options.storageMissing)
        return { data: null, error: { message: "function missing" } };
      if (name === "onboarding_claim_quota")
        return { data: !options.quotaDenied, error: null };
      if (name === "onboarding_read_draft")
        return {
          data: { ...draft, profile: { ...draft.profile } },
          error: null,
        };
      if (name === "onboarding_write_draft") {
        if (draft.complete && args.p_complete && draft.key === args.p_save_key)
          return { data: draft, error: null };
        if (draft.revision !== args.p_revision || draft.complete)
          return { data: null, error: { message: "STALE_DRAFT" } };
        draft.profile = args.p_profile;
        draft.revision++;
        draft.complete = args.p_complete;
        draft.key = args.p_save_key;
        return { data: { ...draft }, error: null };
      }
      throw Error(name);
    },
  };
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: "https://staging.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-anon-fixture",
    ONBOARDING_ALLOWED_ORIGIN: "https://onboarding.example",
    OPENROUTER_API_KEY: "private-key-fixture",
    ONBOARDING_STT_MODEL: "openai/gpt-4o-mini-transcribe",
    ONBOARDING_LLM_MODEL: "openai/gpt-4.1-mini",
    ONBOARDING_TTS_MODEL: "elevenlabs/eleven-flash-v2.5",
    ...options.env,
  };
  const fetcher = async (url, init) => {
    calls.push(["fetch", url, JSON.parse(init.body)]);
    if (options.providerError)
      return { ok: false, status: options.providerError };
    if (url.endsWith("audio/transcriptions"))
      return {
        ok: true,
        json: async () => ({
          text: "I am a designer. My birthday is 4 June 1998.",
        }),
      };
    if (url.endsWith("audio/speech"))
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(20) };
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: options.badJSON
                ? "invalid"
                : JSON.stringify({
                    updates: {
                      name: null,
                      job_details: "Designer",
                      dob: "1998-06-04",
                      caste: null,
                    },
                    skipped: [],
                    clarification: null,
                    ...options.extraction,
                  }),
            },
          },
        ],
      }),
    };
  };
  function load(file) {
    file = path.resolve(file);
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} };
    cache.set(file, mod);
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText;
    vm.runInNewContext(code, {
      module: mod,
      exports: mod.exports,
      process: { env },
      URL,
      URLSearchParams,
      AbortSignal,
      Date,
      TextDecoder,
      Uint8Array,
      fetch: fetcher,
      require(name) {
        if (name === "@supabase/supabase-js")
          return {
            createClient: (...args) => {
              calls.push(["client", args]);
              return db;
            },
          };
        if (name.startsWith("@/")) return load("src/" + name.slice(2) + ".ts");
        if (name.startsWith("."))
          return load(path.resolve(path.dirname(file), name) + ".ts");
        return require(name);
      },
    });
    return mod.exports;
  }
  async function request(route, data, headers = {}, method = "POST") {
    const request = new NextRequest(
      "https://onboarding.example/api/onboarding/" + route,
      {
        method,
        headers: {
          origin: "https://onboarding.example",
          authorization: "Bearer verified-token",
          "content-type": "application/json",
          ...headers,
        },
        ...(method === "POST"
          ? {
              body:
                typeof data === "string" ? data : JSON.stringify(data || {}),
            }
          : {}),
      },
    );
    return load("src/app/api/onboarding/" + route + "/route.ts")[method](
      request,
    );
  }
  return { request, calls, draft, load };
}
const saveKey = "12345678-1234-4123-8123-123456789abc";
test("rejects a foreign origin before authentication or any paid call", async () => {
  const h = harness();
  assert.equal(
    (await h.request("answer", {}, { origin: "https://attacker.example" }))
      .status,
    403,
  );
  assert.equal(h.calls.length, 0);
});
test("rejects missing bearer tokens and anonymous/unverified/non-Google identities", async () => {
  assert.equal(
    (await harness().request("answer", {}, { authorization: "" })).status,
    401,
  );
  for (const user of [
    { is_anonymous: true },
    { email_confirmed_at: null },
    { identities: [{ provider: "email" }] },
  ]) {
    const h = harness({ user });
    assert.equal((await h.request("answer")).status, 401);
    assert.equal(h.calls.filter((c) => c[0] === "fetch").length, 0);
  }
});
test("missing Supabase or OpenRouter settings fail closed", async () => {
  const h = harness({ env: { NEXT_PUBLIC_SUPABASE_ANON_KEY: "" } });
  assert.equal((await h.request("session")).status, 503);
  const p = harness({ env: { OPENROUTER_API_KEY: "" } });
  assert.equal(
    (
      await p.request("answer", {
        text: "Designer",
        language: "en",
        revision: 0,
      })
    ).status,
    503,
  );
  assert.equal(p.calls.filter((c) => c[0] === "fetch").length, 0);
});
test("missing migration blocks provider access", async () => {
  const h = harness({ storageMissing: true });
  assert.equal(
    (
      await h.request("answer", {
        text: "Designer",
        language: "en",
        revision: 0,
      })
    ).status,
    503,
  );
  assert.equal(h.calls.filter((c) => c[0] === "fetch").length, 0);
});
test("shared quota denial returns actual 429 before any provider request", async () => {
  const h = harness({ quotaDenied: true });
  assert.equal(
    (
      await h.request("answer", {
        text: "Designer",
        language: "en",
        revision: 0,
      })
    ).status,
    429,
  );
  assert.equal(h.calls.filter((c) => c[0] === "fetch").length, 0);
});
test("one text answer extracts multiple facts without changing name or saving unconfirmed output", async () => {
  const h = harness();
  const response = await h.request("answer", {
    text: "Designer, born 4 June 1998",
    language: "en",
    revision: 0,
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.proposal.profile.name, "Arya");
  assert.equal(result.proposal.profile.dob, "1998-06-04");
  assert.equal(result.proposal.profile.job_details, "Designer");
  assert.equal(h.draft.revision, 0);
  assert.equal(h.calls.filter((c) => c[0] === "fetch").length, 1);
  assert.equal(
    h.calls.filter((c) => c[0] === "rpc" && c[1] === "onboarding_write_draft")
      .length,
    0,
  );
});
test("audio invokes only OpenRouter STT and extraction with quota before EACH paid request", async () => {
  const h = harness();
  const response = await h.request("answer", {
    audio: "YWJj",
    format: "webm",
    language: "hi",
    revision: 0,
  });
  assert.equal(response.status, 200);
  const boundaries = h.calls.filter(
    (c) =>
      c[0] === "fetch" || (c[0] === "rpc" && c[1] === "onboarding_claim_quota"),
  );
  assert.deepEqual(
    boundaries.map((c) => c[0]),
    ["rpc", "fetch", "rpc", "fetch"],
  );
  assert.ok(
    boundaries
      .filter((c) => c[0] === "fetch")
      .every((c) => c[1].startsWith("https://openrouter.ai/")),
  );
});
test("stale revisions and oversized or malformed recordings are rejected before paid calls", async () => {
  for (const data of [
    { text: "test", language: "en", revision: 5 },
    { audio: "not base64!", format: "webm", language: "en", revision: 0 },
    { audio: "YWJj", format: "exe", language: "en", revision: 0 },
  ]) {
    const h = harness();
    assert.ok([400, 409].includes((await h.request("answer", data)).status));
    assert.equal(h.calls.filter((c) => c[0] === "fetch").length, 0);
  }
  assert.equal(
    (await harness().request("profile", "a".repeat(9000))).status,
    413,
  );
});
test("malformed model output and invalid dates leave the existing profile unchanged", async () => {
  for (const options of [
    { badJSON: true },
    { extraction: { updates: { dob: "2024-02-30" } } },
  ]) {
    const h = harness(options);
    assert.equal(
      (
        await h.request("answer", {
          text: "something",
          language: "en",
          revision: 0,
        })
      ).status,
      422,
    );
    assert.deepEqual(h.draft.profile, { name: "Arya" });
  }
});
test("explicit skip is preserved and community is not inferred or asked", async () => {
  const h = harness({
    extraction: {
      updates: { name: null, job_details: null, dob: null, caste: null },
      skipped: ["dob", "job_details"],
    },
  });
  const result = await (
    await h.request("answer", {
      text: "Skip birthday and work",
      language: "hi",
      revision: 0,
    })
  ).json();
  assert.equal(result.proposal.profile.dob, null);
  assert.equal(result.prompt.clip, "review");
  assert.equal(result.proposal.profile.caste, undefined);
});
test("speech allowlists voices and retains selected Brian", async () => {
  const h = harness();
  assert.equal(
    (await h.request("speech", { voice: "other", text: "hello" })).status,
    400,
  );
  assert.equal(h.calls.filter((c) => c[0] === "fetch").length, 0);
  assert.equal(
    (await h.request("speech", { voice: "brian", text: "Hello" })).status,
    200,
  );
  assert.equal(h.calls.find((c) => c[0] === "fetch")[2].voice, "brian");
});
test("provider errors are sanitized and 429 is preserved", async () => {
  for (const code of [429, 500]) {
    const h = harness({ providerError: code });
    const response = await h.request("answer", {
      text: "Designer",
      language: "en",
      revision: 0,
    });
    assert.equal(response.status, code === 429 ? 429 : 502);
    assert.doesNotMatch(await response.text(), /private-key-fixture/);
  }
});
test("profile saves are owned by verified identity, idempotent, and readable after reload", async () => {
  const h = harness();
  const payload = {
    profile: { name: "Arya", job_details: "Designer", dob: null, caste: null },
    revision: 0,
    complete: true,
    saveKey,
  };
  assert.equal((await h.request("profile", payload)).status, 200);
  assert.equal((await h.request("profile", payload)).status, 200);
  assert.equal(h.draft.revision, 1);
  const result = await (
    await h.request("session", undefined, {}, "GET")
  ).json();
  assert.equal(result.draft.complete, true);
  assert.equal(result.draft.profile.job_details, "Designer");
  const writes = h.calls.filter(
    (c) => c[0] === "rpc" && c[1] === "onboarding_write_draft",
  );
  assert.ok(writes.every((c) => !("user_id" in c[2])));
});
test("manual typed profile saves require no OpenRouter key and reject unknown fields", async () => {
  const h = harness({ env: { OPENROUTER_API_KEY: "" } });
  assert.equal(
    (
      await h.request("profile", {
        profile: { name: "Arya", job_details: null, dob: null },
        revision: 0,
        complete: true,
        saveKey,
      })
    ).status,
    200,
  );
  assert.equal(h.calls.filter((c) => c[0] === "fetch").length, 0);
  assert.equal(
    (
      await harness().request("profile", {
        profile: { name: "Arya", user_id: "victim" },
        revision: 0,
        complete: false,
        saveKey,
      })
    ).status,
    400,
  );
});

test("every profile field is optional, including an entirely empty completed profile", async () => {
  for (const profile of [
    {},
    { name: null, job_details: null, dob: null, caste: null },
    { name: "", job_details: "", dob: "", caste: "" },
  ]) {
    const h = harness();
    const response = await h.request("profile", {
      profile,
      revision: 0,
      complete: true,
      saveKey,
    });
    assert.equal(response.status, 200);
    assert.equal(h.draft.complete, true);
    assert.equal(h.calls.filter((c) => c[0] === "fetch").length, 0);
  }
});
test("explicit name skip is accepted without being re-inferred", async () => {
  const h = harness({
    extraction: {
      updates: { name: null, job_details: null, dob: null, caste: null },
      skipped: ["name", "job_details", "dob", "caste"],
    },
  });
  const response = await h.request("answer", {
    text: "Skip all details",
    language: "en",
    revision: 0,
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.proposal.profile.name, null);
  assert.equal(result.prompt.clip, "review");
});
test("optional storage cannot block verified sign-in or expose anonymous paid access", async () => {
  const h = harness({ storageMissing: true });
  const response = await h.request("session", undefined, {}, "GET");
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.profileReady, false);
  assert.equal(result.draft, null);
  assert.equal(result.voiceConfigured, false);
  assert.ok(result.workspace);
  assert.equal(h.calls.filter((c) => c[0] === "fetch").length, 0);
  assert.equal(
    (
      await harness({ noUser: true }).request("profile", {
        profile: {},
        revision: 0,
        complete: true,
        saveKey,
      })
    ).status,
    401,
  );
});

test("spoken help answers a question without changing optional details", async () => {
  const h = harness({
    extraction: {
      updates: { name: null, job_details: null, dob: null, caste: null },
      skipped: [],
      clarification: null,
      reply:
        "Only Google sign-in is required. Every profile detail is optional.",
    },
  });
  const response = await h.request("answer", {
    text: "Do I have to give my birthday?",
    question: "What is your birthday?",
    language: "en",
    revision: 0,
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.proposal.profile.name, "Arya");
  assert.equal(result.prompt.review, false);
  assert.match(result.prompt.text, /optional/);
  const request = h.calls.find(
    (c) => c[0] === "fetch" && c[1].endsWith("chat/completions"),
  );
  assert.equal(
    JSON.parse(request[2].messages[1].content).previousQuestion,
    "What is your birthday?",
  );
});
test("invalid question context is rejected before paid provider calls", async () => {
  const h = harness();
  const response = await h.request("answer", {
    text: "Hello",
    question: "x".repeat(301),
    language: "en",
    revision: 0,
  });
  assert.equal(response.status, 400);
  assert.equal(h.calls.filter((c) => c[0] === "fetch").length, 0);
});


test("optional phone and intended usage save and read back without paid inference", async () => {
  const h = harness({ env: { OPENROUTER_API_KEY: "" } });
  const profile = { name: null, phone: "+91 98765 43210", usage: "Team projects" };
  const response = await h.request("profile", { profile, revision: 0, complete: true, saveKey: "12345678-1234-4234-8234-123456789abc" });
  assert.equal(response.status, 200);
  const read = await h.request("session", undefined, {}, "GET");
  assert.deepEqual((await read.json()).draft.profile, profile);
  assert.equal(h.calls.filter(c => c[0] === "fetch").length, 0);
});
test("invalid optional phone is rejected before any write", async () => {
  const h = harness();
  const response = await h.request("profile", { profile: { phone: "call me" }, revision: 0, complete: true, saveKey: "12345678-1234-4234-8234-123456789abc" });
  assert.equal(response.status, 400);
  assert.equal(h.calls.filter(c => c[0] === "rpc").length, 0);
});
