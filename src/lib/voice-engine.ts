/**
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on
 * an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations under the License.
 */

import { GoogleGenAI, LiveCallbacks, LiveConnectConfig, LiveServerMessage, Part, Session } from '@google/genai';
import { EventEmitter } from 'eventemitter3';
import { saveInteraction } from '../app/api/services/chat';
import { SaveInteractionPayload } from '../types/chat';
import { LiveClientOptions } from '../types/live-api';
import { sendErrorToSlack } from './slackService';

export type GetAudioContextOptions = AudioContextOptions & {
  id?: string;
};

const map: Map<string, AudioContext> = new Map();

export const audioContext: (options?: GetAudioContextOptions) => Promise<AudioContext> = (() => {
  const didInteract =
    typeof window !== 'undefined'
      ? new Promise<void>((res) => {
          window.addEventListener('pointerdown', () => res(), { once: true });
          window.addEventListener('keydown', () => res(), { once: true });
        })
      : undefined;

  return async (options?: GetAudioContextOptions) => {
    if (typeof window === 'undefined' || typeof AudioContext === 'undefined') {
      throw new Error('AudioContext is not supported on the server.');
    }

    try {
      const a = new Audio();
      a.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
      await a.play();
      if (options?.id && map.has(options.id)) {
        const ctx = map.get(options.id);
        if (ctx) {
          return ctx;
        }
      }
      const ctx = new AudioContext(options);
      if (options?.id) {
        map.set(options.id, ctx);
      }
      return ctx;
    } catch {
      if (didInteract) {
        await didInteract;
      }
      if (options?.id && map.has(options.id)) {
        const ctx = map.get(options.id);
        if (ctx) {
          return ctx;
        }
      }
      const ctx = new AudioContext(options);
      if (options?.id) {
        map.set(options.id, ctx);
      }
      return ctx;
    }
  };
})();

export function base64ToArrayBuffer(base64: string) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

// --- From audioworklet-registry.ts ---

export type WorkletGraph = {
  node?: AudioWorkletNode;
  handlers: Array<(this: MessagePort, ev: MessageEvent) => void>;
};

export const registeredWorklets: Map<AudioContext, Record<string, WorkletGraph>> = new Map();

export const createWorketFromSrc = (workletName: string, workletSrc: string) => {
  const script = new Blob([`registerProcessor("${workletName}", ${workletSrc})`], {
    type: 'application/javascript',
  });

  return URL.createObjectURL(script);
};

// --- From worklets ---

const AudioRecordingWorklet = `
class AudioProcessingWorklet extends AudioWorkletProcessor {
  // Buffer 2048 samples, which at 16khz is about 8 times a second
  buffer = new Float32Array(2048);
  bufferWriteIndex = 0;

  constructor() {
    super();
  }

  process(inputs) {
    if (inputs[0] && inputs[0][0]) {
      this.processChunk(inputs[0][0]);
    }
    return true;
  }

  sendAndClearBuffer() {
    this.port.postMessage({
      event: 'chunk',
      data: {
        float32arrayBuffer: this.buffer.slice(0, this.bufferWriteIndex).buffer,
      },
    });
    this.bufferWriteIndex = 0;
  }

  processChunk(float32Array) {
    let data = float32Array;
    while (data.length > 0) {
      const spaceLeft = this.buffer.length - this.bufferWriteIndex;
      if (spaceLeft <= 0) {
        this.sendAndClearBuffer();
        continue;
      }
      const toCopy = data.subarray(0, Math.min(data.length, spaceLeft));
      this.buffer.set(toCopy, this.bufferWriteIndex);
      this.bufferWriteIndex += toCopy.length;
      data = data.subarray(toCopy.length);
    }

    if (this.bufferWriteIndex >= this.buffer.length) {
      this.sendAndClearBuffer();
    }
  }
}
`;

const VolMeterWorket = `
  class VolMeter extends AudioWorkletProcessor {
    volume
    updateIntervalInMS
    nextUpdateFrame

    constructor() {
      super()
      this.volume = 0
      this.updateIntervalInMS = 25
      this.nextUpdateFrame = this.updateIntervalInMS
      this.port.onmessage = event => {
        if (event.data.updateIntervalInMS) {
          this.updateIntervalInMS = event.data.updateIntervalInMS
        }
      }
    }

    get intervalInFrames() {
      return (this.updateIntervalInMS / 1000) * sampleRate
    }

    process(inputs) {
      const input = inputs[0]

      if (input.length > 0) {
        const samples = input[0]
        let sum = 0
        let rms = 0

        for (let i = 0; i < samples.length; ++i) {
          sum += samples[i] * samples[i]
        }

        rms = Math.sqrt(sum / samples.length)
        this.volume = Math.max(rms, this.volume * 0.7)

        this.nextUpdateFrame -= samples.length
        if (this.nextUpdateFrame < 0) {
          this.nextUpdateFrame += this.intervalInFrames
          this.port.postMessage({volume: this.volume})
        }
      }

      return true
    }
  }`;

// --- From audio-recorder.ts ---

export class AudioRecorder extends EventEmitter {
  stream: MediaStream | undefined;
  audioContext: AudioContext | undefined;
  source: MediaStreamAudioSourceNode | undefined;
  recording: boolean = false;
  recordingWorklet: AudioWorkletNode | undefined;
  vuWorklet: AudioWorkletNode | undefined;
  isMuted: boolean = false;

  private starting: Promise<void> | null = null;

  constructor(public sampleRate = 16000) {
    super();
  }

  toggleMute() {
    if (this.stream) {
      this.isMuted = !this.isMuted;
      this.stream.getAudioTracks().forEach((track) => {
        track.enabled = !this.isMuted;
      });
      this.emit('mute', this.isMuted);
    }
  }

  private resample(sourceRate: number, targetRate: number, data: Float32Array): Float32Array {
    if (sourceRate === targetRate) {
      return data;
    }

    const ratio = sourceRate / targetRate;
    const newLength = Math.round(data.length / ratio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;

    while (offsetResult < result.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
      let accum = 0;
      let count = 0;
      for (let i = offsetBuffer; i < nextOffsetBuffer && i < data.length; i++) {
        accum += data[i];
        count++;
      }
      result[offsetResult] = accum / count;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }

    return result;
  }

  async start() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Could not request user media');
    }

    this.starting = new Promise(async (resolve, reject) => {
      try {
        try {
          this.stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              sampleRate: { ideal: this.sampleRate },
            },
          });
        } catch (e) {
          console.warn(`Could not get audio with ideal sample rate, trying without constraint.`, e);

          this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }

        this.audioContext = await audioContext();
        const streamSampleRate = this.audioContext.sampleRate;

        if (!streamSampleRate) {
          throw new Error('Could not get sample rate from media stream');
        }

        this.source = this.audioContext.createMediaStreamSource(this.stream);

        const workletName = 'audio-recorder-worklet';
        const src = createWorketFromSrc(workletName, AudioRecordingWorklet);

        await this.audioContext.audioWorklet.addModule(src);
        this.recordingWorklet = new AudioWorkletNode(this.audioContext, workletName);

        this.recordingWorklet.port.onmessage = async (ev: MessageEvent) => {
          const { float32arrayBuffer } = ev.data.data;
          if (!float32arrayBuffer) {
            return;
          }

          let samples = new Float32Array(float32arrayBuffer);

          if (streamSampleRate !== this.sampleRate) {
            samples = this.resample(streamSampleRate, this.sampleRate, samples);
          }

          const int16Array = new Int16Array(samples.length);
          for (let i = 0; i < samples.length; i++) {
            int16Array[i] = Math.max(-32768, Math.min(32767, samples[i] * 32768));
          }

          const arrayBufferString = arrayBufferToBase64(int16Array.buffer);
          this.emit('data', arrayBufferString);
        };
        this.source.connect(this.recordingWorklet);

        // vu meter worklet
        const vuWorkletName = 'vu-meter';
        await this.audioContext.audioWorklet.addModule(createWorketFromSrc(vuWorkletName, VolMeterWorket));
        this.vuWorklet = new AudioWorkletNode(this.audioContext, vuWorkletName);
        this.vuWorklet.port.onmessage = (ev: MessageEvent) => {
          this.emit('volume', ev.data.volume);
        };

        this.source.connect(this.vuWorklet);
        this.recording = true;
        resolve();
      } catch (error) {
        reject(error);
      } finally {
        this.starting = null;
      }
    });
  }

  stop() {
    // its plausible that stop would be called before start completes
    // such as if the websocket immediately hangs up
    const handleStop = () => {
      this.source?.disconnect();
      this.stream?.getTracks().forEach((track) => track.stop());
      this.stream = undefined;
      this.recordingWorklet = undefined;
      this.vuWorklet = undefined;
    };
    if (this.starting) {
      this.starting.then(handleStop);
      return;
    }
    handleStop();
  }
}

// --- From audio-streamer.ts ---

export class AudioStreamer {
  private sampleRate: number = 24000;
  private bufferSize: number = 7680;
  // A queue of audio buffers to be played. Each buffer is a Float32Array.
  private audioQueue: Float32Array[] = [];
  private isPlaying: boolean = false;
  // Indicates if the stream has finished playing, e.g., interrupted.
  private isStreamComplete: boolean = false;
  private checkInterval: number | null = null;
  private scheduledTime: number = 0;
  private initialBufferTime: number = 0.1; //0.1 // 100ms initial buffer
  // Web Audio API nodes. source => gain => destination
  public gainNode: GainNode;
  public source: AudioBufferSourceNode;
  private endOfQueueAudioSource: AudioBufferSourceNode | null = null;

  public onComplete = () => {};

  constructor(public context: AudioContext) {
    this.gainNode = this.context.createGain();
    this.source = this.context.createBufferSource();
    this.gainNode.connect(this.context.destination);
    this.addPCM16 = this.addPCM16.bind(this);
  }

  async addWorklet<T extends (d: unknown) => void>(workletName: string, workletSrc: string, handler: T): Promise<this> {
    let workletsRecord = registeredWorklets.get(this.context);
    if (workletsRecord && workletsRecord[workletName]) {
      // the worklet already exists on this context
      // add the new handler to it
      workletsRecord[workletName].handlers.push(handler);
      return Promise.resolve(this);
      //throw new Error(`Worklet ${workletName} already exists on context`);
    }

    if (!workletsRecord) {
      registeredWorklets.set(this.context, {});
      workletsRecord = registeredWorklets.get(this.context)!;
    }

    // create new record to fill in as becomes available
    workletsRecord[workletName] = { handlers: [handler] };

    const src = createWorketFromSrc(workletName, workletSrc);
    await this.context.audioWorklet.addModule(src);
    const worklet = new AudioWorkletNode(this.context, workletName);

    //add the node into the map
    workletsRecord[workletName].node = worklet;

    return this;
  }

  /**
   * Converts a Uint8Array of PCM16 audio data into a Float32Array. PCM16 is a common raw audio format, but the Web
   * Audio API generally expects audio data as Float32Arrays with samples normalized between -1.0 and 1.0. This function
   * handles that conversion.
   *
   * @param chunk The Uint8Array containing PCM16 audio data.
   * @returns A Float32Array representing the converted audio data.
   */
  private _processPCM16Chunk(chunk: Uint8Array): Float32Array {
    const float32Array = new Float32Array(chunk.length / 2);
    const dataView = new DataView(chunk.buffer);

    for (let i = 0; i < chunk.length / 2; i++) {
      try {
        const int16 = dataView.getInt16(i * 2, true);
        float32Array[i] = int16 / 32768;
      } catch (e) {
        console.error(e);
      }
    }
    return float32Array;
  }

  addPCM16(chunk: Uint8Array) {
    // Reset the stream complete flag when a new chunk is added.
    this.isStreamComplete = false;
    // Process the chunk into a Float32Array
    let processingBuffer = this._processPCM16Chunk(chunk);
    // Add the processed buffer to the queue if it's larger than the buffer size.
    // This is to ensure that the buffer is not too large.
    while (processingBuffer.length >= this.bufferSize) {
      const buffer = processingBuffer.slice(0, this.bufferSize);
      this.audioQueue.push(buffer);
      processingBuffer = processingBuffer.slice(this.bufferSize);
    }
    // Add the remaining buffer to the queue if it's not empty.
    if (processingBuffer.length > 0) {
      this.audioQueue.push(processingBuffer);
    }
    // Start playing if not already playing.
    if (!this.isPlaying) {
      this.isPlaying = true;
      // Initialize scheduledTime only when we start playing
      this.scheduledTime = this.context.currentTime + this.initialBufferTime;
      this.scheduleNextBuffer();
    }
  }

  private createAudioBuffer(audioData: Float32Array): AudioBuffer {
    const audioBuffer = this.context.createBuffer(1, audioData.length, this.sampleRate);
    audioBuffer.getChannelData(0).set(audioData);
    return audioBuffer;
  }

  private scheduleNextBuffer() {
    const SCHEDULE_AHEAD_TIME = 0.2;

    while (this.audioQueue.length > 0 && this.scheduledTime < this.context.currentTime + SCHEDULE_AHEAD_TIME) {
      const audioData = this.audioQueue.shift()!;
      const audioBuffer = this.createAudioBuffer(audioData);
      const source = this.context.createBufferSource();

      if (this.audioQueue.length === 0) {
        if (this.endOfQueueAudioSource) {
          this.endOfQueueAudioSource.onended = null;
        }
        this.endOfQueueAudioSource = source;
        source.onended = () => {
          if (!this.audioQueue.length && this.endOfQueueAudioSource === source) {
            this.endOfQueueAudioSource = null;
            this.onComplete();
          }
        };
      }

      source.buffer = audioBuffer;
      source.connect(this.gainNode);

      const worklets = registeredWorklets.get(this.context);

      if (worklets) {
        Object.entries(worklets).forEach(([, graph]) => {
          const { node, handlers } = graph;
          if (node) {
            source.connect(node);
            node.port.onmessage = function (ev: MessageEvent) {
              handlers.forEach((handler) => {
                handler.call(node.port, ev);
              });
            };
            node.connect(this.context.destination);
          }
        });
      }
      // Ensure we never schedule in the past
      const startTime = Math.max(this.scheduledTime, this.context.currentTime);
      source.start(startTime);
      this.scheduledTime = startTime + audioBuffer.duration;
    }

    if (this.audioQueue.length === 0) {
      if (this.isStreamComplete) {
        this.isPlaying = false;
        if (this.checkInterval) {
          clearInterval(this.checkInterval);
          this.checkInterval = null;
        }
      } else {
        if (!this.checkInterval) {
          this.checkInterval = window.setInterval(() => {
            if (this.audioQueue.length > 0) {
              this.scheduleNextBuffer();
            }
          }, 100) as unknown as number;
        }
      }
    } else {
      const nextCheckTime = (this.scheduledTime - this.context.currentTime) * 1000;
      setTimeout(() => this.scheduleNextBuffer(), Math.max(0, nextCheckTime - 50));
    }
  }

  stop() {
    this.isPlaying = false;
    this.isStreamComplete = true;
    this.audioQueue = [];
    this.scheduledTime = this.context.currentTime;

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    this.gainNode.gain.linearRampToValueAtTime(0, this.context.currentTime + 0.1);

    setTimeout(() => {
      this.gainNode.disconnect();
      this.gainNode = this.context.createGain();
      this.gainNode.connect(this.context.destination);
    }, 200);
  }

  async resume() {
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }
    this.isStreamComplete = false;
    this.scheduledTime = this.context.currentTime + this.initialBufferTime;
    this.gainNode.gain.setValueAtTime(1, this.context.currentTime);
  }

  complete() {
    this.isStreamComplete = true;
    this.onComplete();
  }
}

// --- From genai-live-client.ts ---

export interface LiveClientEventTypes {
  audio: (data: ArrayBuffer) => void;
  close: (event: CloseEvent) => void;
  error: (error: ErrorEvent) => void;
  interrupted: () => void;
  open: () => void;
  setupcomplete: () => void;
  turncomplete: () => void;
  transcript: (type: 'input' | 'output', text: string) => void;
  usage: (usage: { promptTokenCount?: number; responseTokenCount?: number; totalTokenCount?: number }) => void;
}

export class GenAILiveClient extends EventEmitter<LiveClientEventTypes> {
  protected client: GoogleGenAI | null = null;
  private readonly clientOptions: LiveClientOptions;

  private _status: 'connected' | 'disconnected' | 'connecting' | 'disconnecting' = 'disconnected';
  public get status() {
    return this._status;
  }

  private _currentTurnState: {
    userTranscript: string;
    assistantTranscript: string;
    isInterrupted: boolean;
    usage: {
      promptTokenCount?: number;
      responseTokenCount?: number;
      totalTokenCount?: number;
    } | null;
  } = {
    userTranscript: '',
    assistantTranscript: '',
    isInterrupted: false,
    usage: null,
  };

  private _session: Session | null = null;
  private _sessionId: string | null = null;
  private _isFirstTurn: boolean = false;

  public get session() {
    return this._session;
  }

  private _model: string | null = null;
  public get model() {
    return this._model;
  }

  protected config: LiveConnectConfig | null = null;

  public getConfig() {
    return { ...this.config };
  }

  constructor(options: LiveClientOptions) {
    super();
    // Lazy-init to avoid crashing Next.js build/SSR when API key isn't present.
    // We only need a live client when the user explicitly connects voice.
    this.clientOptions = options;
    this.onopen = this.onopen.bind(this);
    this.onerror = this.onerror.bind(this);
    this.onclose = this.onclose.bind(this);
    this.onmessage = this.onmessage.bind(this);
  }

  async connect(model: string, config: LiveConnectConfig): Promise<boolean> {
    if (this.status === 'connected' || this.status === 'connecting') {
      return false;
    }

    this._status = 'connecting';
    this.config = config;
    this._model = model;
    this._sessionId = crypto.randomUUID();
    this._isFirstTurn = true;

    const callbacks: LiveCallbacks = {
      onopen: this.onopen,
      onmessage: this.onmessage,
      onerror: this.onerror,
      onclose: this.onclose,
    };

    try {
      if (!this.client) {
        this.client = new GoogleGenAI(this.clientOptions);
      }

      this._session = await this.client.live.connect({
        model,
        config,
        callbacks,
      });
    } catch (e) {
      const errorDetails = e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : e;
      sendErrorToSlack({ message: 'Error connecting to GenAI Live', errorResponse: errorDetails });
      this._status = 'disconnected';
      return false;
    }

    this._status = 'connected';
    return true;
  }

  public disconnect(): Promise<boolean> {
    if (this.status === 'disconnected' || this.status === 'disconnecting') {
      return Promise.resolve(false);
    }
    this._status = 'disconnecting';

    return new Promise((resolve) => {
      // The onclose listener will handle the final state change
      this.once('close', () => resolve(true));

      if (this.session) {
        // Manually save the conversation state before closing
        const { userTranscript, assistantTranscript, usage } = this._currentTurnState;
        if (userTranscript || assistantTranscript) {
          this.saveMessagesToBackend(userTranscript, assistantTranscript, usage);
        }

        // Reset state after saving
        this._currentTurnState = {
          userTranscript: '',
          assistantTranscript: '',
          isInterrupted: false,
          usage: null,
        };

        this.session.close();
      } else {
        // If there's no session, we can resolve immediately
        // and ensure the state is correct.
        this._status = 'disconnected';
        resolve(true);
      }

      // Failsafe in case 'close' doesn't fire from the session
      setTimeout(() => {
        if (this.status !== 'disconnected') {
          this.onclose(new CloseEvent('close', { reason: 'Disconnect timeout' }));
        }
      }, 500);
    });
  }

  protected onopen() {
    this._status = 'connected';
    this.emit('open');
  }

  protected onerror(e: ErrorEvent) {
    sendErrorToSlack({
      message: 'GenAILiveClient WebSocket Error',
      errorResponse: { message: e.message, filename: e.filename, lineno: e.lineno },
    });
    this.emit('error', e);
  }

  protected onclose(e: CloseEvent) {
    if (e.code !== 1000) {
      sendErrorToSlack({
        message: `GenAILiveClient.onclose: Connection closed unexpectedly.`,
        errorResponse: {
          reason: e.reason,
          code: e.code,
          wasClean: e.wasClean,
        },
      });
    }
    this._session = null;
    this._status = 'disconnected';
    this.emit('close', e);
  }

  protected async onmessage(message: LiveServerMessage) {
    if (message.usageMetadata) {
      this._currentTurnState.usage = {
        promptTokenCount: message.usageMetadata.promptTokenCount,
        responseTokenCount: message.usageMetadata.responseTokenCount,
        totalTokenCount: message.usageMetadata.totalTokenCount,
      };
      this.emit('usage', this._currentTurnState.usage);
    }

    if (message.setupComplete) {
      this.emit('setupcomplete');
      return;
    }

    if (message.serverContent) {
      const { serverContent } = message;

      if (serverContent.inputTranscription?.text) {
        this._currentTurnState.userTranscript += serverContent.inputTranscription.text;
        this.emit('transcript', 'input', serverContent.inputTranscription.text);
      }

      if (serverContent.outputTranscription?.text) {
        // Only append to assistant transcript if not interrupted
        if (!this._currentTurnState.isInterrupted) {
          this._currentTurnState.assistantTranscript += serverContent.outputTranscription.text;
          this.emit('transcript', 'output', serverContent.outputTranscription.text);
        }
      }

      if ('interrupted' in serverContent) {
        // Mark as interrupted first to stop accepting new transcript chunks
        this._currentTurnState.isInterrupted = true;

        // When interrupted, save the conversation up to the interruption point
        const { assistantTranscript, usage } = this._currentTurnState;
        let { userTranscript } = this._currentTurnState;

        if (this._isFirstTurn) {
          userTranscript = '';
          this._isFirstTurn = false;
        }

        this.saveMessagesToBackend(userTranscript, assistantTranscript, usage);

        // Reset for the next turn
        this._currentTurnState = {
          userTranscript: '',
          assistantTranscript: '',
          isInterrupted: false,
          usage: null,
        };

        this.emit('interrupted');
        return;
      }

      if ('turnComplete' in serverContent) {
        const { assistantTranscript, usage } = this._currentTurnState;
        let { userTranscript } = this._currentTurnState;

        if (this._isFirstTurn) {
          userTranscript = '';
          this._isFirstTurn = false;
        }

        // Save both messages together
        this.saveMessagesToBackend(userTranscript, assistantTranscript, usage);

        // Reset for the next turn
        this._currentTurnState = {
          userTranscript: '',
          assistantTranscript: '',
          isInterrupted: false,
          usage: null,
        };
        this.emit('turncomplete');
      }

      if ('modelTurn' in serverContent) {
        const parts: Part[] = serverContent.modelTurn?.parts || [];

        const audioParts = parts.filter((p) => p.inlineData && p.inlineData.mimeType?.startsWith('audio/pcm'));
        const base64s = audioParts.map((p) => p.inlineData?.data);

        base64s.forEach((b64) => {
          if (b64) {
            const data = base64ToArrayBuffer(b64);
            this.emit('audio', data);
          }
        });
      }
    } else {
      console.log('received unmatched message', message);
    }
  }

  /** Send realtimeInput, this is base64 chunks of "audio/pcm" */
  async sendRealtimeInput(chunks: Array<{ mimeType: string; data: string }>) {
    if (this.status !== 'connected') {
      sendErrorToSlack({
        message: `GenAILiveClient.sendRealtimeInput: Not connected, status is ${this.status}. Skipping send.`,
      });
      return;
    }

    for (const ch of chunks) {
      this.session?.sendRealtimeInput({ media: ch });
    }
  }

  async sendText(text: string) {
    if (this.status !== 'connected') {
      return;
    }
    this.session?.sendRealtimeInput({ text });
  }

  private async saveMessagesToBackend(
    userTranscript: string,
    assistantTranscript: string,
    usage?: {
      promptTokenCount?: number;
      responseTokenCount?: number;
      totalTokenCount?: number;
    } | null,
  ) {
    const trimmedUser = userTranscript.trim();
    const trimmedAssistant = assistantTranscript.trim();

    if ((!trimmedUser || trimmedUser === '<noise>' || trimmedUser === '.') && !trimmedAssistant) {
      return;
    }

    try {
      const config = this.config as LiveConnectConfig & {
        device_info?: Record<string, unknown>;
        network_info?: Record<string, unknown>;
      };
      const deviceInfo = config?.device_info ?? null;
      const networkInfo = config?.network_info ?? null;

      const interactionPayload: SaveInteractionPayload = {
        user_message: trimmedUser,
        assistant_message: trimmedAssistant,
        user_message_tokens: usage?.promptTokenCount ?? 0,
        assistant_message_tokens: usage?.responseTokenCount ?? 0,
        session_id: this._sessionId ?? undefined,
        device: deviceInfo ? JSON.stringify(deviceInfo) : undefined,
        network: networkInfo ? JSON.stringify(networkInfo) : undefined,
      };

      await saveInteraction(interactionPayload);
    } catch (error) {
      console.error('Failed to save messages:', error);
      sendErrorToSlack({ message: 'Failed to save messages to backend', errorResponse: error as object });
    }
  }
}
