// Browser verification with simulated Supabase identity and onboarding API responses.
const { chromium } = require(
  process.env.MEERA_PLAYWRIGHT_MODULE ||
    "/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
);
const assert = require("node:assert/strict");
const fs = require("node:fs");
const base = process.env.ONBOARDING_TEST_URL || "http://127.0.0.1:3223";
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const forbidden = [];
  page.on("request", (r) => {
    if (/cloudflare|generativelanguage/.test(r.url())) forbidden.push(r.url());
  });
  const user = {
    id: "12345678-1234-4123-8123-123456789abc",
    aud: "authenticated",
    role: "authenticated",
    email: "arya@example.test",
    app_metadata: { provider: "google", providers: ["google"] },
    user_metadata: { full_name: "Arya" },
    identities: [{ provider: "google" }],
    created_at: new Date().toISOString(),
  };
  const jwt = [
    Buffer.from("{}").toString("base64url"),
    Buffer.from(
      JSON.stringify({
        sub: user.id,
        exp: Math.floor(Date.now() / 1000) + 3600,
        role: "authenticated",
      }),
    ).toString("base64url"),
    "mock-signature",
  ].join(".");
  await page.addInitScript(
    ({ user, jwt }) => {
      localStorage.setItem(
        "sb-staging-auth-token",
        JSON.stringify({
          access_token: jwt,
          refresh_token: "mock-refresh",
          token_type: "bearer",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          user,
        }),
      );
      window.__tracks = [];
      navigator.mediaDevices.getUserMedia = async () => {
        const audio = new AudioContext();
        const stream = audio.createMediaStreamDestination().stream;
        window.__tracks.push(...stream.getTracks());
        return stream;
      };
    },
    { user, jwt },
  );
  await page.route("https://staging.supabase.co/**", (route) =>
    route.fulfill({ json: user }),
  );
  let stored = { profile: {}, revision: 0, complete: false },
    key,
    deny = false,
    fail = false,
    delayed = false,
    release;
  let delaySession = false,
    sessionRelease;
  const requests = [];
  await page.route("**/api/onboarding/session", async (route) => {
    if (delaySession)
      await new Promise((resolve) => {
        sessionRelease = resolve;
      });
    return route.fulfill({
      json: {
        draft: stored,
        googleName: "Arya",
        workspace: base + "/workspace-test",
        voiceConfigured: true,
      },
    });
  });
  await page.route("**/api/onboarding/profile", async (route) => {
    const data = route.request().postDataJSON();
    requests.push(data);
    if (stored.complete && data.complete && key === data.saveKey)
      return route.fulfill({ json: { draft: stored } });
    if (data.revision !== stored.revision)
      return route.fulfill({
        status: 409,
        json: { error: "Stale profile. Please reload." },
      });
    stored = {
      profile: data.profile,
      revision: stored.revision + 1,
      complete: data.complete,
    };
    key = data.saveKey;
    return route.fulfill({ json: { draft: stored } });
  });
  await page.route("**/api/onboarding/answer", async (route) => {
    const data = route.request().postDataJSON();
    requests.push(data);
    if (delayed)
      await new Promise((resolve) => {
        release = resolve;
      });
    if (deny)
      return route.fulfill({
        status: 429,
        json: {
          error: "Voice allowance reached. Please use the editable profile.",
        },
      });
    if (fail)
      return route.fulfill({
        status: 502,
        json: {
          error: "Voice is temporarily unavailable. You can type instead.",
        },
      });
    return route.fulfill({
      json: {
        proposal: {
          revision: stored.revision,
          profile: {
            ...stored.profile,
            job_details: data.text?.includes("teacher")
              ? "Teacher"
              : "Designer",
            dob: "1998-06-04",
          },
        },
        transcript: data.text || "I am a designer, born 4 June 1998.",
        prompt: { text: "Please review your profile.", clip: "review" },
      },
    });
  });
  await page.goto(base + "/onboarding");
  await page.getByText("Signed in as arya@example.test").waitFor();
  await page.getByRole("textbox", { name: "Name", exact: true }).waitFor();
  assert.equal(
    await page.getByRole("textbox", { name: "Name", exact: true }).inputValue(),
    "Arya",
  );
  assert.equal(
    await page.locator("input[name=voice]:checked").inputValue(),
    "on",
  );
  await page.getByLabel("Brian", { exact: false }).check();
  await page.getByLabel("Language").selectOption("hi");
  const clip = page.waitForResponse((r) =>
    r.url().includes("brian-hi-preview.mp3"),
  );
  await page.getByRole("button", { name: "Preview" }).nth(1).click();
  assert.equal((await clip).status(), 200);
  await page
    .getByLabel("Your answer or correction")
    .fill("I am a designer, born 4 June 1998.");
  await page.getByRole("button", { name: "Send answer", exact: true }).click();
  await page.getByRole("textbox", { name: "Work or study" }).fill("Teacher");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page
    .getByText("Draft saved. Come back whenever you are ready.")
    .waitFor();
  assert.equal(stored.profile.job_details, "Teacher");
  await page.reload();
  await page.getByRole("textbox", { name: "Work or study" }).waitFor();
  await page.waitForFunction(() =>
    [...document.querySelectorAll("input")].some(
      (input) => input.value === "Teacher",
    ),
  );
  assert.equal(
    await page.getByRole("textbox", { name: "Work or study" }).inputValue(),
    "Teacher",
  );
  deny = true;
  await page
    .getByLabel("Your answer or correction")
    .fill("Please update my job.");
  await page.getByRole("button", { name: "Send answer", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "allowance reached" })
    .waitFor();
  deny = false;
  fail = true;
  await page.getByRole("button", { name: "Send answer", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "temporarily unavailable" })
    .waitFor();
  fail = false;
  // Real MediaRecorder over a silent synthetic MediaStream: no live provider is contacted.
  await page
    .getByRole("button", { name: "Start voice — allow microphone" })
    .click();
  await page
    .getByRole("button", { name: "Mute microphone", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Unmute microphone", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Stop / interrupt", exact: true })
    .click();
  await page.waitForFunction(() =>
    window.__tracks.every((t) => t.readyState === "ended"),
  );
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("Denied", "NotAllowedError");
    };
  });
  await page
    .getByRole("button", { name: "Record an answer", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Microphone access is unavailable" })
    .waitFor();
  // Delayed answer can be interrupted without applying a late proposal.
  delayed = true;
  await page
    .getByLabel("Your answer or correction")
    .fill("Correction to teacher");
  await page.getByRole("button", { name: "Send answer", exact: true }).click();
  await page
    .getByRole("button", { name: "Stop / interrupt", exact: true })
    .click();
  if (release) release();
  delayed = false;
  await page
    .getByRole("textbox", { name: "Caste or community (optional)" })
    .fill("");
  await page
    .getByRole("button", { name: "Save and begin", exact: true })
    .click();
  await page.getByText("Your saved profile has been restored.").waitFor();
  assert.equal(stored.complete, true);
  assert.equal(stored.profile.caste, null);
  await page.reload();
  await page.getByText("Your saved profile has been restored.").waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Save and begin" }).count(),
    0,
  );
  // A late profile response must not restore the prior account's personal data after sign-out.
  delaySession = true;
  const pendingReload = page.waitForRequest((request) =>
    request.url().endsWith("/api/onboarding/session"),
  );
  await page.getByRole("button", { name: "Reload saved profile" }).click();
  await pendingReload;
  await page.evaluate(() => {
    const channel = new BroadcastChannel("sb-staging-auth-token");
    channel.postMessage({ event: "SIGNED_OUT", session: null });
    setTimeout(() => channel.close(), 100);
  });
  await page.getByRole("button", { name: "Continue with Google" }).waitFor();
  if (sessionRelease) sessionRelease();
  await page.waitForTimeout(150);
  assert.equal(
    await page.getByText("Your saved profile has been restored.").count(),
    0,
  );
  assert.equal(forbidden.length, 0);
  assert.deepEqual(errors, []);
  const results = [
    "mobile form renders and reuses Google name",
    "Brian/Hindi static audio preview returns 200",
    "multi-fact text answer and editable correction",
    "owned draft reload",
    "HTTP 429 and provider failure preserve form",
    "record/mute/unmute/interrupt release microphone tracks",
    "denied microphone retains typing",
    "cancelled response not applied",
    "optional community skipped",
    "save and readback; completed user bypasses setup",
    "no Cloudflare or Gemini network requests",
    "late profile response cannot restore prior-account data after sign-out",
  ];
  fs.writeFileSync(
    "work/openrouter/browser-results.json",
    JSON.stringify(
      { mode: "simulated identity and providers", results },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
