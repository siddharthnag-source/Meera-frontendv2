// Loopback-only experiment. No OAuth, database, production keys or dotenv loading.
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { newSession, nextField, questions, propose, confirm, finish } from './core.mjs';
import { provider } from './openrouter.mjs';
export function createExperiment(voice = null) {
  const sessions = new Map();
  const token = randomBytes(24).toString('hex');
  let calls = 0;
  const server = http.createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    try {
      if (req.headers.host !== new URL(origin).host) return send(403, { error: 'Loopback host required.' });
      if (req.method === 'GET' && req.url === '/') {
        const html = (await readFile(new URL('./index.html', import.meta.url), 'utf8')).replace('__TOKEN__', token).replace('__MODE__', voice ? 'Live OpenRouter experiment' : 'Mock experiment — typed answers only');
        res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' }); return res.end(html);
      }
      if (req.method !== 'POST' || req.headers.origin !== origin || req.headers['x-experiment-token'] !== token) return send(403, { error: 'Local experiment access required.' });
      let raw = ''; for await (const part of req) { raw += part; if (raw.length > 3000000) return send(413, { error: 'Recording too large.' }); }
      const body = JSON.parse(raw);
      for (const [id, s] of sessions) if (Date.now() - s.created > 15 * 60000) sessions.delete(id);
      if (req.url === '/start') {
        if (body.consent !== true) return send(400, { error: 'Consent required.' });
        if (sessions.size >= 10) return send(429, { error: 'Experiment session limit.' });
        const id = randomBytes(16).toString('hex'); sessions.set(id, { ...newSession(), created: Date.now(), busy: false });
        return send(200, { id, field: 'name', question: questions.name, live: !!voice });
      }
      const s = sessions.get(body.id);
      if (!s) return send(401, { error: 'Start a new session.' });
      if (s.busy) return send(409, { error: 'Wait for the current turn.' });
      s.busy = true;
      try {
        if (req.url === '/cancel') { sessions.delete(body.id); return send(200, { cancelled: true }); }
        if (s.complete) return send(409, { error: 'Session complete.' });
        if (req.url === '/answer') {
          if (s.pending) return send(409, { error: 'Confirm or edit your current answer.' });
          const field = body.field || nextField(s);
          let value;
          if (body.skip === true) value = null;
          else {
            let text = body.text;
            if (body.audio) {
              if (!voice) return send(503, { error: 'Voice requires a configured OpenRouter key.' });
              if ((calls += 2) > 100) return send(429, { error: 'Local experiment provider call cap reached.' });
              text = await voice.transcribe(body.audio, body.format);
              value = await voice.extract(field, text);
            } else value = text; // Typed form input is exact; no unnecessary model call.
          }
          propose(s, field, value);
          return send(200, { pending: s.pending });
        }
        if (req.url === '/reject') s.pending = null;
        else if (req.url === '/confirm') confirm(s);
        else if (req.url === '/finish') return send(200, { profile: finish(s), saved: false, message: 'Experiment complete. Profile has NOT been saved to Meera.' });
        else if (req.url === '/speak') {
          if (!voice) return send(503, { error: 'Speech requires live configuration.' });
          if (++calls > 100) return send(429, { error: 'Local experiment provider call cap reached.' });
          const text = questions[nextField(s)] || 'Please review your profile and confirm when ready.';
          const audio = await voice.speak(text); res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' }); return res.end(audio);
        } else return send(404, { error: 'Unknown action.' });
        const field = nextField(s); return send(200, { field, question: questions[field], profile: s.profile });
      } finally { s.busy = false; }
    } catch (error) { send(400, { error: error.message }); }
  });
  return { server, token };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const live = process.argv.includes('--live');
  if (live && process.env.VOICE_EXPERIMENT_SPEND_APPROVED !== 'true') throw new Error('Set a capped staging OpenRouter key and explicitly approve experiment spend first.');
  const voice = live ? provider({ key: process.env.OPENROUTER_API_KEY, stt: process.env.ONBOARDING_STT_MODEL, llm: process.env.ONBOARDING_LLM_MODEL, tts: process.env.ONBOARDING_TTS_MODEL, voice: process.env.ONBOARDING_TTS_VOICE }) : null;
  createExperiment(voice).server.listen(3231, '127.0.0.1', () => console.log('Open http://127.0.0.1:3231 — local experiment, no Google login or database writes.'));
}
