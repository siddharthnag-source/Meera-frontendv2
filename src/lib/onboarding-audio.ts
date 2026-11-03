import { EventEmitter } from "eventemitter3";

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer;
}

const recordingWorklet = `class MeeraCapture extends AudioWorkletProcessor {
  buffer = new Float32Array(2048); offset = 0;
  process(inputs) {
    const samples = inputs[0]?.[0];
    if (samples) for (const sample of samples) {
      this.buffer[this.offset++] = sample;
      if (this.offset === this.buffer.length) {
        this.port.postMessage(this.buffer.slice()); this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('meera-capture', MeeraCapture);`;

/** Microphone capture owned by a single onboarding session. */
export class AudioRecorder extends EventEmitter {
  isMuted = false;
  private stream?: MediaStream;
  private context?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private processor?: AudioWorkletNode | ScriptProcessorNode;
  private generation = 0;
  constructor(private sampleRate = 16000) {
    super();
  }

  async start() {
    const generation = ++this.generation;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    if (generation !== this.generation) {
      stream.getTracks().forEach((track) => track.stop());
      throw new DOMException("Microphone request cancelled.", "AbortError");
    }
    this.stream = stream;
    try {
      const context = new AudioContext();
      this.context = context;
      await context.resume();
      if (generation !== this.generation) return;
      this.source = context.createMediaStreamSource(stream);
      const send = (samples: Float32Array) => {
        if (this.isMuted || generation !== this.generation) return;
        let sum = 0;
        for (const sample of samples) sum += sample * sample;
        this.emit("volume", Math.sqrt(sum / samples.length));
        const ratio = context.sampleRate / this.sampleRate;
        const length = Math.floor(samples.length / ratio);
        const bytes = new Uint8Array(length * 2);
        const view = new DataView(bytes.buffer);
        for (let i = 0; i < length; i++) {
          const begin = Math.floor(i * ratio);
          const end = Math.min(
            samples.length,
            Math.max(begin + 1, Math.floor((i + 1) * ratio)),
          );
          let value = 0;
          for (let j = begin; j < end; j++) value += samples[j];
          view.setInt16(
            i * 2,
            Math.max(-32768, Math.min(32767, (value / (end - begin)) * 32768)),
            true,
          );
        }
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        this.emit("data", btoa(binary));
      };
      try {
        const url = URL.createObjectURL(
          new Blob([recordingWorklet], { type: "application/javascript" }),
        );
        try {
          await context.audioWorklet.addModule(url);
        } finally {
          URL.revokeObjectURL(url);
        }
        if (generation !== this.generation) return;
        const processor = new AudioWorkletNode(context, "meera-capture");
        processor.port.onmessage = (event) => send(event.data);
        this.processor = processor;
      } catch (error) {
        if (generation !== this.generation) return;
        if (context.state === "closed") throw error;
        const processor = context.createScriptProcessor(2048, 1, 1);
        processor.onaudioprocess = (event) =>
          send(event.inputBuffer.getChannelData(0));
        this.processor = processor;
      }
      const silence = context.createGain();
      silence.gain.value = 0;
      this.source.connect(this.processor!);
      this.processor!.connect(silence);
      silence.connect(context.destination);
    } catch (error) {
      this.stop();
      throw error;
    }
  }
  toggleMute() {
    this.isMuted = !this.isMuted;
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = !this.isMuted;
    });
  }
  stop() {
    this.generation++;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.source?.disconnect();
    this.processor?.disconnect();
    if (this.context?.state !== "closed")
      void this.context?.close().catch(() => {});
    this.stream = undefined;
    this.context = undefined;
    this.source = undefined;
    this.processor = undefined;
    this.removeAllListeners();
  }
}

/** Schedule PCM audio, and stop every scheduled source immediately on interruption. */
export class AudioStreamer {
  onComplete = () => {};
  private sources = new Set<AudioBufferSourceNode>();
  private nextTime = 0;
  constructor(private context: AudioContext) {}
  addPCM16(bytes: Uint8Array) {
    if (this.context.state === "closed" || bytes.byteLength < 2) return;
    const pcm = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const buffer = this.context.createBuffer(
      1,
      Math.floor(bytes.byteLength / 2),
      24000,
    );
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < channel.length; i++)
      channel[i] = pcm.getInt16(i * 2, true) / 32768;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    this.sources.add(source);
    source.onended = () => {
      source.disconnect();
      this.sources.delete(source);
      if (!this.sources.size) this.onComplete();
    };
    const start = Math.max(this.nextTime, this.context.currentTime + 0.04);
    source.start(start);
    this.nextTime = start + buffer.duration;
  }
  stop() {
    for (const source of this.sources) {
      source.onended = null;
      source.stop();
      source.disconnect();
    }
    this.sources.clear();
    this.nextTime = 0;
  }
}
