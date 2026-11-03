// Simulated provider verification; never represents a live Gemini or OAuth test.
const { chromium } = require(
  process.env.MEERA_PLAYWRIGHT_MODULE || "playwright",
);
const assert = require("node:assert/strict");
const fs = require("node:fs");
const base = process.env.ONBOARDING_TEST_URL || "http://127.0.0.1:3222";
(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: [
      "--no-sandbox",
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  });
  const results = [];
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__tracks = [];
    navigator.mediaDevices.getUserMedia = async () => {
      const audio = new AudioContext();
      const stream = audio.createMediaStreamDestination().stream;
      window.__tracks.push(...stream.getTracks());
      return stream;
    };
  });
  await page.route(
    "https://challenges.cloudflare.com/turnstile/v0/api.js**",
    (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: `window.turnstile={render:(el,options)=>{window.__challenge=options;setTimeout(()=>options.callback('test-challenge'),10);return 'test-widget'},reset:()=>{setTimeout(()=>window.__challenge.callback('test-challenge'),10)},remove:()=>{}};`,
      }),
  );
  let failToken = false,
    delayToken = false,
    tokenResolve;
  await page.route("**/api/onboarding/session", async (route) => {
    if (delayToken)
      await new Promise((resolve) => {
        tokenResolve = resolve;
      });
    await route.fulfill({
      status: failToken ? 403 : 200,
      json: failToken
        ? { error: "Verification expired. Please try again." }
        : { token: "auth_tokens/test-browser", model: "test-native-audio" },
    });
  });
  const sockets = [],
    messages = [];
  const audio = Buffer.alloc(9600).toString("base64");
  const respond = (socket, text) =>
    socket.send(
      JSON.stringify({
        serverContent: {
          outputTranscription: { text },
          modelTurn: {
            role: "model",
            parts: [
              { inlineData: { data: audio, mimeType: "audio/pcm;rate=24000" } },
            ],
          },
          turnComplete: true,
        },
      }),
    );
  await page.routeWebSocket(
    "wss://generativelanguage.googleapis.com/**",
    (socket) => {
      sockets.push(socket);
      socket.onMessage((raw) => {
        const data = JSON.parse(raw.toString());
        messages.push(data);
        if (data.setup) socket.send(JSON.stringify({ setupComplete: {} }));
        if (data.clientContent)
          respond(
            socket,
            data.clientContent.turns?.[0]?.parts?.[0]?.text?.includes("silence")
              ? "Take your time! Let me know whenever you are ready for the next step."
              : "Hi! Welcome to Himeera. Ready to get started?",
          );
      });
    },
  );
  const tracksStopped = () =>
    page.waitForFunction(() =>
      window.__tracks.every((track) => track.readyState === "ended"),
    );
  await page.clock.install();
  await page.goto(base + "/onboarding");
  await page.getByRole("button", { name: "Talk to Meera" }).click();
  await page.getByText("Meera is listening", { exact: true }).waitFor();
  await page
    .getByText("Hi! Welcome to Himeera. Ready to get started?", {
      exact: false,
    })
    .waitFor();
  results.push(
    "start, token response, SDK setup, streamed PCM and transcript render (simulated)",
  );
  await page
    .getByRole("button", { name: "Mute microphone", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("button", { name: "Unmute microphone" })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.getByRole("button", { name: "Unmute microphone" }).click();
  results.push("mute and unmute");
  sockets
    .at(-1)
    .send(
      JSON.stringify({
        serverContent: {
          inputTranscription: { text: "Yes, please." },
          interrupted: true,
        },
      }),
    );
  await page.getByText("Yes, please.", { exact: false }).waitFor();
  results.push("interruption message and user transcript");
  // Advance page time so the reminder and hard session deadline can be checked without waiting five minutes.
  respond(sockets.at(-1), "Let us continue.");
  await page.waitForTimeout(600);
  await page.clock.fastForward(5100);
  await page.waitForTimeout(100);
  const reminderCount = messages.filter((message) =>
    JSON.stringify(message.clientContent || {}).includes("silence reminder"),
  ).length;
  assert.equal(reminderCount, 1, "one reminder after five seconds of silence");
  await page.clock.fastForward(20000);
  await page.waitForTimeout(100);
  assert.equal(
    messages.filter((message) =>
      JSON.stringify(message.clientContent || {}).includes("silence reminder"),
    ).length,
    1,
  );
  results.push("one silence reminder after five seconds, no repeated reminder");
  await page.getByRole("button", { name: "End conversation" }).click();
  await tracksStopped();
  results.push("end conversation stops microphone tracks");
  await page.getByRole("button", { name: "Talk to Meera" }).click();
  await page.getByText("Meera is listening", { exact: true }).waitFor();
  await page.clock.fastForward(300100);
  await page.getByText("Session ended", { exact: true }).waitFor();
  await tracksStopped();
  results.push("five-minute session deadline stops microphone");
  await page.getByRole("button", { name: "Talk to Meera" }).click();
  await page.getByText("Meera is listening", { exact: true }).waitFor();
  sockets.at(-1).close({ code: 1001, reason: "simulated network disconnect" });
  await page.getByText("Session ended", { exact: true }).waitFor();
  await tracksStopped();
  results.push("restart and network disconnect stop microphone tracks");
  failToken = true;
  await page.getByRole("button", { name: "Talk to Meera" }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Verification expired" })
    .waitFor();
  await tracksStopped();
  results.push("expired challenge reports error and releases microphone");
  failToken = false;
  delayToken = true;
  await page.getByRole("button", { name: "Talk to Meera" }).click();
  await page.waitForFunction(() =>
    window.__tracks.some((track) => track.readyState === "live"),
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await tracksStopped();
  if (tokenResolve) tokenResolve();
  delayToken = false;
  results.push("cancel while connecting releases microphone");
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("Permission denied", "NotAllowedError");
    };
  });
  await page.getByRole("button", { name: "Talk to Meera" }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Permission denied" })
    .waitFor();
  results.push("microphone permission denial shown");
  await page.getByRole("link", { name: "Continue to Google sign-up" }).click();
  await page
    .getByRole("heading", { name: "Continue to your account" })
    .waitFor();
  results.push("sign-up handoff page renders; external OAuth not tested");
  fs.writeFileSync(
    "work/onboarding/browser-results.json",
    JSON.stringify({ mode: "simulated providers", results }, null, 2),
  );
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
