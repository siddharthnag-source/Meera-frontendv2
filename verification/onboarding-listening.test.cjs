const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const ts = require('typescript');
const fs = require('node:fs');
async function setup() {
  let now = 0, tick, amplitude = 0, muted = false, closed = 0;
  const events = [];
  const node = () => ({ connect() {}, disconnect() {} });
  class AudioContext {
    state = 'running'; destination = {};
    createMediaStreamSource() { return node(); }
    createAnalyser() { return { ...node(), fftSize: 512, getFloatTimeDomainData(data) { data.fill(amplitude); } }; }
    createGain() { return { ...node(), gain: { value: 1 } }; }
    async resume() {} async close() { this.state = 'closed'; closed++; }
  }
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/onboarding-listening.ts','utf8'), { compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022} }).outputText, {
    exports, AudioContext, Float32Array, performance: { now: () => now },
    setInterval(fn) { tick = fn; return 1; }, clearInterval() { tick = undefined; },
  });
  const monitor = exports.watchSpeech({}, { isMuted: () => muted, onLevel() {}, onFinish: () => events.push('finish'), onIdle: () => events.push('idle'), onWaiting: () => events.push('waiting'), onUnsupported: () => events.push('unsupported') });
  await Promise.resolve();
  return { monitor, events, advance(ms) { for (let i=0;i<ms;i+=80) { now += 80; tick?.(); } }, sound(value) { amplitude=value; }, mute(value) { muted=value; }, closed: () => closed };
}
test('speech followed by silence submits once and closes the audio context', async () => {
  const h=await setup(); h.sound(.1); h.advance(400); h.sound(0); h.advance(2000);
  assert.deepEqual(h.events,['finish']); assert.equal(h.monitor.heardSpeech(),true);
  h.advance(2000); assert.deepEqual(h.events,['finish']); assert.equal(h.closed(),1);
});
test('silence reminds once then stops without submitting', async () => {
  const h=await setup(); h.advance(5600); assert.deepEqual(h.events,['waiting']); h.advance(8000);
  assert.deepEqual(h.events,['waiting','idle']); assert.equal(h.monitor.heardSpeech(),false);
});
test('mute defers silence completion and cancellation suppresses later callbacks', async () => {
  const h=await setup(); h.sound(.1); h.advance(400); h.mute(true); h.sound(0); h.advance(16000);
  assert.deepEqual(h.events,[]); h.monitor.stop(); h.advance(20000);
  assert.deepEqual(h.events,[]); assert.equal(h.closed(),1);
});
