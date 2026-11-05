// UI/provider boundary verification with synthetic identity and recordings; no live provider calls.
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
    args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
  });
  const results = [];
  // Allowed autoplay: starts on load exactly once, without asking for a microphone or paid API call.
  const guestContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const guest = await guestContext.newPage();
  const paid = [];
  guest.on("request", (r) => {
    if (r.url().includes("/api/onboarding/") && !r.url().includes("/clips/"))
      paid.push(r.url());
  });
  await guest.addInitScript(() => {
    window.__plays = 0;
    window.__mics = 0;
    const real = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      window.__plays++;
      return real.call(this);
    };
    navigator.mediaDevices.getUserMedia = async () => {
      window.__mics++;
      throw Error("No anonymous microphone");
    };
  });
  await guest.goto(base + "/onboarding");
  await guest.getByText("Meera is speaking", { exact: true }).waitFor();
  assert.equal(await guest.evaluate(() => window.__plays), 1);
  assert.equal(await guest.evaluate(() => window.__mics), 0);
  assert.equal(paid.length, 0);
  assert.equal(
    await guest.getByRole("button", { name: "Hear Meera’s welcome" }).count(),
    0,
  );
  const google = guest.getByRole("button", { name: "Continue with Google" });
  assert.ok(
    (await google.evaluate((e) => getComputedStyle(e).animationName)).includes(
      "signin-invite",
    ),
  );
  await guest.getByRole("button", { name: "Tap to interrupt Meera" }).click();
  await guest.screenshot({
    path: "work/prototype/landing-mobile.png",
    fullPage: true,
  });
  await guest.setViewportSize({ width: 1440, height: 900 });
  await guest.screenshot({
    path: "work/prototype/landing-desktop.png",
    fullPage: true,
  });

  await guest
    .getByRole("button", { name: "Choose a voice", exact: true })
    .click();
  await guest.getByLabel("Brian", { exact: true }).check();
  await guest.getByLabel("Language").selectOption("hi");
  const preview = guest.waitForResponse((r) =>
    r.url().endsWith("brian-hi-preview.mp3"),
  );
  await guest
    .getByRole("button", { name: "Preview", exact: true })
    .nth(1)
    .click();
  assert.equal((await preview).status(), 200);
  await guest.getByRole("button", { name: "Close panel" }).click();
  await guest.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await google.evaluate((e) => getComputedStyle(e).animationName),
    "none",
  );
  assert.equal(
    await guest.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  results.push(
    "automatic recorded intro once after load; no anonymous microphone or paid calls",
    "visible prompt, pulsing Google CTA, reduced-motion support and prototype layout",
    "Sarah/Brian, Hindi previews and native settings dialog",
  );
  await guestContext.close();
  // Simulate a browser rejecting audible autoplay; a manual permission control must remain.
  const blockedContext = await browser.newContext();
  const blocked = await blockedContext.newPage();
  await blocked.addInitScript(() => {
    window.__attempts = 0;
    const real = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      window.__attempts++;
      if (window.__attempts === 1)
        return Promise.reject(
          new DOMException("Autoplay blocked", "NotAllowedError"),
        );
      return real.call(this);
    };
  });
  await blocked.goto(base + "/onboarding");
  await blocked.getByRole("button", { name: "Enable Meera’s voice" }).waitFor();
  assert.equal(await blocked.evaluate(() => window.__attempts), 1);
  await blocked.getByRole("button", { name: "Enable Meera’s voice" }).click();
  await blocked.getByText("Meera is speaking", { exact: true }).waitFor();
  assert.equal(await blocked.evaluate(() => window.__attempts), 2);
  results.push(
    "blocked autoplay has an explicit enable-sound fallback, without retry loops",
  );
  await blockedContext.close();
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
  async function seed(target) {
    await target.addInitScript(
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
    await target.route("https://staging.supabase.co/**", (route) =>
      route.fulfill({ json: user }),
    );
  }
  await seed(page);
  let stored = { profile: {}, revision: 0, complete: false },
    saveKey,
    deny = false,
    fail = false,
    delayed = false,
    release,
    delaySession = false,
    releaseSession;
  await page.route("**/api/onboarding/session", async (route) => {
    if (delaySession) await new Promise((r) => (releaseSession = r));
    return route.fulfill({
      json: {
        draft: stored,
        profileReady: true,
        googleName: "Arya",
        workspace: base + "/workspace-test",
        voiceConfigured: true,
      },
    });
  });
  await page.route("**/api/onboarding/profile", async (route) => {
    const data = route.request().postDataJSON();
    if (stored.complete && data.complete && saveKey === data.saveKey)
      return route.fulfill({ json: { draft: stored } });
    if (data.revision !== stored.revision)
      return route.fulfill({
        status: 409,
        json: { error: "Reload your draft" },
      });
    stored = {
      profile: data.profile,
      revision: stored.revision + 1,
      complete: data.complete,
    };
    saveKey = data.saveKey;
    return route.fulfill({ json: { draft: stored } });
  });
  await page.route("**/api/onboarding/answer", async (route) => {
    const data = route.request().postDataJSON();
    if (delayed) await new Promise((r) => (release = r));
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
            job_details: "Designer",
            dob: "1998-06-04",
          },
        },
        transcript: data.text || "I am a designer.",
        prompt: { text: "Please review your profile.", clip: "review" },
      },
    });
  });
  await page.goto(base + "/onboarding");
  await page.getByRole("button", { name: "Add details (optional)" }).click();
  const name = page.getByRole("textbox", {
    name: "What should Meera call you? (optional)",
    exact: true,
  });
  await name.fill("");
  assert.equal(await page.locator("input[required]").count(), 0);
  await page
    .getByLabel("Your answer or correction")
    .fill("I am a designer, born 4 June 1998.");
  await page.getByRole("button", { name: "Send answer", exact: true }).click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll("input")].some((e) => e.value === "Designer"),
  );
  assert.equal(stored.profile.name, null);
  await page
    .getByRole("textbox", { name: "Work or study (optional)", exact: true })
    .fill("Teacher");
  const savedDraft = page.waitForResponse(
    (response) =>
      response.url().endsWith("/profile") &&
      response.request().postDataJSON()?.profile?.job_details === "Teacher",
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await savedDraft;
  await page.waitForFunction(() =>
    [...document.querySelectorAll("button")].some(
      (button) => button.textContent === "Save draft" && !button.disabled,
    ),
  );
  await page.waitForFunction(
    () => document.querySelector("dialog button") !== null,
  );
  await page.getByRole("button", { name: "Close panel" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Add details (optional)" }).click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll("input")].some((e) => e.value === "Teacher"),
  );
  assert.equal(await name.inputValue(), "");
  results.push(
    "all details optional; blank name stays skipped after save/reload",
    "multi-fact extraction, corrections and owned draft resume",
  );
  deny = true;
  await page
    .getByLabel("Your answer or correction")
    .fill("Please change my work");
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
  await page.getByRole("button", { name: "Close panel" }).click();
  const question = page.waitForResponse(
    (r) => r.url().includes("/clips/") && r.url().endsWith("-review.mp3"),
  );
  await page
    .getByRole("button", { name: "Start voice — allow microphone" })
    .click();
  assert.equal((await question).status(), 200);
  await page.getByText("Meera is speaking", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__tracks.length), 0);
  await page
    .getByRole("button", { name: "Mute microphone", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Unmute microphone", exact: true })
    .click();
  await page.getByRole("button", { name: "Tap to interrupt Meera" }).click();
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
  await page.getByRole("button", { name: "End Call", exact: true }).click();
  results.push(
    "assistant-first call, mute/unmute, interruption and released microphone",
    "denied microphone, HTTP 429 and provider failure preserve typing",
  );
  delayed = true;
  await page.getByLabel("Your answer or correction").fill("Late correction");
  const pending = page.waitForRequest((r) => r.url().endsWith("/answer"));
  await page.getByRole("button", { name: "Send answer", exact: true }).click();
  await pending;
  await page.getByRole("button", { name: "Close panel" }).click();
  await page.getByRole("button", { name: "Expand voice view" }).click(); // control works independently of the form
  await page.getByRole("button", { name: "Tap to interrupt Meera" }).click();
  await page.getByRole("button", { name: "Add details (optional)" }).click();
  await page.getByRole("button", { name: "Reload saved profile" }).click();
  if (release) release();
  delayed = false;
  for (const label of [
    "What should Meera call you? (optional)",
    "Birthday (optional)",
    "Work or study (optional)",
    "Caste or community (optional)",
  ])
    await page.getByLabel(label, { exact: true }).fill("");
  await page
    .getByRole("button", { name: "Save and begin", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Open Meera", exact: false })
    .first()
    .waitFor();
  assert.equal(stored.complete, true);
  assert.equal(stored.profile.name, null);
  assert.equal(stored.profile.dob, null);
  assert.equal(stored.profile.job_details, null);
  results.push(
    "empty personalization can be completed and read back; no compulsory name/DOB/work",
  );
  await page.reload();
  await page.getByRole("link", { name: "Open Meera", exact: false }).waitFor();
  await page.getByRole("button", { name: "Show transcripts" }).click();
  await page
    .getByRole("heading", { name: "Transcripts", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Close panel" }).click();
  assert.equal(forbidden.length, 0);
  assert.deepEqual(errors, []);
  results.push(
    "transcripts and focus-view controls are functional; no Google inference or Cloudflare requests",
  );
  delaySession = true;
  await page.getByRole("button", { name: "Add details (optional)" }).click();
  const pendingReload = page.waitForRequest((r) =>
    r.url().endsWith("/api/onboarding/session"),
  );
  await page.getByRole("button", { name: "Reload saved profile" }).click();
  await pendingReload;
  await page.evaluate(() => {
    const channel = new BroadcastChannel("sb-staging-auth-token");
    channel.postMessage({ event: "SIGNED_OUT", session: null });
    setTimeout(() => channel.close(), 100);
  });
  await page.getByRole("button", { name: "Continue with Google" }).waitFor();
  if (releaseSession) releaseSession();
  await page.waitForTimeout(100);
  assert.equal(
    await page.getByText("Your saved profile has been restored.").count(),
    0,
  );
  results.push(
    "late responses cannot restore prior-account profile data after sign-out",
  );
  // Missing optional storage never traps a verified account in onboarding.
  const skipContext = await browser.newContext();
  const skip = await skipContext.newPage();
  await seed(skip);
  const skipWrites = [];
  skip.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/api/onboarding/"))
      skipWrites.push(r.url());
  });
  await skip.route("**/api/onboarding/session", (route) =>
    route.fulfill({
      json: {
        draft: null,
        profileReady: false,
        googleName: "Arya",
        workspace: base + "/workspace-test",
        voiceConfigured: false,
      },
    }),
  );
  await skip.route("**/workspace-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<main>Meera workspace</main>",
    }),
  );
  await skip.goto(base + "/onboarding");
  await skip
    .getByRole("link", { name: "Skip for now — continue to Meera" })
    .click();
  await skip.getByText("Meera workspace", { exact: true }).waitFor();
  assert.equal(skipWrites.length, 0);
  results.push(
    "Google-only continuation works without optional profile storage or paid calls",
  );
  fs.writeFileSync(
    "work/prototype/browser-results.json",
    JSON.stringify(
      {
        mode: "synthetic identity/provider responses; allowed and blocked autoplay",
        results,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
