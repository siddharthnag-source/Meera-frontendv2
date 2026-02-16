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

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveAPIContext } from '../contexts/LiveAPIContext';
import { AudioRecorder } from '../lib/voice-engine';

export function useMediaStreamMux() {
  const [active, setActive] = useState(false);
  const { client } = useLiveAPIContext();
  const [audioRecorder] = useState(() => new AudioRecorder());
  const [isMuted, setIsMuted] = useState(audioRecorder.isMuted);
  const onDataHandlerRef = useRef<((base64: string) => void) | null>(null);

  useEffect(() => {
    const onMute = (muted: boolean) => {
      setIsMuted(muted);
    };
    audioRecorder.on('mute', onMute);
    return () => {
      audioRecorder.off('mute', onMute);
    };
  }, [audioRecorder]);

  const start = useCallback(
    async (options: { audio: { mic: boolean; system: boolean }; video: boolean }) => {
      const onData = (base64: string) => {
        client.sendRealtimeInput([
          {
            mimeType: 'audio/pcm;rate=16000',
            data: base64,
          },
        ]);
      };
      if (options.audio.mic) {
        if (onDataHandlerRef.current) {
          audioRecorder.off('data', onDataHandlerRef.current);
        }

        onDataHandlerRef.current = onData;
        audioRecorder.on('data', onData);

        try {
          await audioRecorder.start();
        } catch (error) {
          audioRecorder.off('data', onData);
          onDataHandlerRef.current = null;
          setActive(false);

          const domError = error as DOMException;
          if (domError?.name === 'NotAllowedError') {
            throw new Error('Microphone permission denied. Please allow microphone access in Safari Settings and try again.');
          }
          if (domError?.name === 'NotFoundError') {
            throw new Error('No microphone was found on this device.');
          }
          if (error instanceof Error) {
            throw error;
          }
          throw new Error('Failed to access microphone.');
        }
      }
      setActive(true);
    },
    [client, audioRecorder],
  );

  const stop = useCallback(() => {
    if (onDataHandlerRef.current) {
      audioRecorder.off('data', onDataHandlerRef.current);
      onDataHandlerRef.current = null;
    }
    audioRecorder.stop();
    setActive(false);
  }, [audioRecorder]);

  const toggleMute = useCallback(() => {
    audioRecorder.toggleMute();
  }, [audioRecorder]);

  return { active, start, stop, isMuted, toggleMute };
}
