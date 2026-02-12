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

import { LiveConnectConfig } from '@google/genai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { audioContext, AudioStreamer, GenAILiveClient } from '../lib/voice-engine';
import { LiveClientOptions } from '../types/live-api';

export type UseLiveAPIResults = {
  client: GenAILiveClient;
  setConfig: (config: LiveConnectConfig) => void;
  config: LiveConnectConfig;
  model: string;
  setModel: (model: string) => void;
  connected: boolean;
  isSpeaking: boolean;
  connect: (model: string, config: LiveConnectConfig) => Promise<boolean>;
  disconnect: () => Promise<void>;
  volume: number;
  outputDevices: MediaDeviceInfo[];
  activeOutputDevice?: MediaDeviceInfo;
  setAudioOutput: (deviceId: string) => void;
};

interface AudioContextWithSink extends AudioContext {
  setSinkId(sinkId: string): Promise<void>;
}

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

export function useLiveAPI(options: LiveClientOptions): UseLiveAPIResults {
  const client = useMemo(() => new GenAILiveClient(options), [options]);
  const audioStreamerRef = useRef<AudioStreamer | null>(null);
  const audioCtxRef = useRef<AudioContextWithSink | null>(null);

  const [model, setModel] = useState<string>('models/gemini-2.0-flash-exp');
  const [config, setConfig] = useState<LiveConnectConfig>({});
  const [connected, setConnected] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [volume, setVolume] = useState(0);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [activeOutputDevice, setActiveOutputDevice] = useState<MediaDeviceInfo>();

  // register audio for streaming server -> speakers
  useEffect(() => {
    if (!audioStreamerRef.current) {
      audioContext({ id: 'audio-out' }).then((audioCtx: AudioContext) => {
        audioCtxRef.current = audioCtx as AudioContextWithSink;
        audioStreamerRef.current = new AudioStreamer(audioCtx);
        audioStreamerRef.current
          .addWorklet('vumeter-out', VolMeterWorket, (ev: unknown) => {
            const event = ev as MessageEvent<{ volume: number }>;
            setVolume(event.data.volume);
          })
          .then(() => {
            // Successfully added worklet
          });
      });
    }
  }, [audioStreamerRef]);

  useEffect(() => {
    const getDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioOutputs = devices.filter((d) => d.kind === 'audiooutput');
        setOutputDevices(audioOutputs);
        if (!activeOutputDevice && audioOutputs.length > 0) {
          setActiveOutputDevice(audioOutputs[0]);
        }
      } catch (error) {
        console.error('Error enumerating devices:', error);
      }
    };

    navigator.mediaDevices.addEventListener('devicechange', getDevices);
    getDevices();

    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', getDevices);
    };
  }, [activeOutputDevice]);

  useEffect(() => {
    const onOpen = () => {
      setConnected(true);
    };

    const onClose = () => {
      audioStreamerRef.current?.stop();
      setConnected(false);
      setIsSpeaking(false);
    };

    const onError = (error: ErrorEvent) => {
      console.error('error', error);
      setIsSpeaking(false);
    };

    const stopAudioStreamer = () => {
      audioStreamerRef.current?.stop();
      setIsSpeaking(false);
    };

    const onAudio = (data: ArrayBuffer) => {
      setIsSpeaking(true);
      audioStreamerRef.current?.addPCM16(new Uint8Array(data));
    };

    const onTurnComplete = () => {
      setIsSpeaking(false);
    };

    client
      .on('error', onError)
      .on('open', onOpen)
      .on('close', onClose)
      .on('interrupted', stopAudioStreamer)
      .on('audio', onAudio)
      .on('turncomplete', onTurnComplete);

    return () => {
      client
        .off('error', onError)
        .off('open', onOpen)
        .off('close', onClose)
        .off('interrupted', stopAudioStreamer)
        .off('audio', onAudio)
        .off('turncomplete', onTurnComplete)
        .disconnect();
    };
  }, [client]);

  const connect = useCallback(
    async (model: string, config: LiveConnectConfig) => {
      if (client.status === 'connected' || client.status === 'connecting') {
        return false;
      }
      setModel(model);
      setConfig(config);
      await client.disconnect();
      return client.connect(model, config);
    },
    [client],
  );

  const disconnect = useCallback(async () => {
    audioStreamerRef.current?.stop();
    await client.disconnect();
    setConnected(false);
  }, [setConnected, client]);

  const setAudioOutput = useCallback(
    async (deviceId: string) => {
      if (audioCtxRef.current && 'setSinkId' in audioCtxRef.current) {
        try {
          await audioCtxRef.current.setSinkId(deviceId);
          setActiveOutputDevice(outputDevices.find((d) => d.deviceId === deviceId));
        } catch (error) {
          console.error('Failed to set audio output device:', error);
        }
      } else {
        console.warn('Audio output device selection is not supported.');
      }
    },
    [outputDevices],
  );

  return {
    client,
    config,
    setConfig,
    model,
    setModel,
    connected,
    isSpeaking,
    connect,
    disconnect,
    volume,
    outputDevices,
    activeOutputDevice,
    setAudioOutput,
  };
}
