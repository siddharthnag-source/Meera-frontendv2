"use client";

export type SpeechMonitor = { stop: () => void; heardSpeech: () => boolean };
/** Local-only level/silence detection; never transcribes or uploads audio. */
export function watchSpeech(
  stream: MediaStream,
  options: {
    isMuted: () => boolean;
    onLevel: (level: number) => void;
    onFinish: () => void;
    onIdle: () => void;
    onWaiting: () => void;
    onUnsupported: () => void;
  },
): SpeechMonitor | null {
  if (typeof AudioContext === "undefined") {
    options.onUnsupported();
    return null;
  }
  let context: AudioContext;
  try {
    context = new AudioContext();
  } catch {
    options.onUnsupported();
    return null;
  }
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  const silence = context.createGain();
  silence.gain.value = 0;
  source.connect(analyser);
  analyser.connect(silence);
  silence.connect(context.destination);
  const data = new Float32Array(analyser.fftSize);
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopped = false,
    heard = false,
    voicedMs = 0;
  let reminded = false;
  let lastSound = performance.now(),
    began = lastSound,
    lastTick = began;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer) clearInterval(timer);
    source.disconnect();
    analyser.disconnect();
    silence.disconnect();
    options.onLevel(0);
    if (context.state !== "closed") void context.close().catch(() => {});
  };
  void context
    .resume()
    .then(() => {
      if (stopped) return;
      timer = setInterval(() => {
        if (stopped) return;
        const now = performance.now(),
          delta = Math.min(160, now - lastTick);
        lastTick = now;
        if (options.isMuted()) {
          lastSound = now;
          began = now;
          options.onLevel(0);
          return;
        }
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        for (const sample of data) sum += sample * sample;
        const rms = Math.sqrt(sum / data.length);
        options.onLevel(Math.min(1, rms * 7));
        if (rms > 0.015) {
          voicedMs += delta;
          lastSound = now;
          if (voicedMs >= 160) heard = true;
        }
        if (!heard && !reminded && now - began >= 5000) {
          reminded = true;
          options.onWaiting();
        }
        if (heard && now - lastSound >= 1500) {
          stop();
          options.onFinish();
        } else if (!heard && now - began >= 12000) {
          stop();
          options.onIdle();
        }
      }, 80);
    })
    .catch(() => {
      if (!stopped) {
        stop();
        options.onUnsupported();
      }
    });
  return { stop, heardSpeech: () => heard };
}
