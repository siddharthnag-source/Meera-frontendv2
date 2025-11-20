// src/hooks/useMessageSubmission.ts
import { useCallback, useRef } from 'react';
import { ChatMessageFromServer } from '@/types/chat';

type LLMMessage = { role: 'user' | 'assistant'; content: string };

// keep last N turns for context
const CONTEXT_WINDOW = 20;

export function useMessageSubmission({
  messages,
  setMessages,
  setIsStreaming,
  setCurrentThoughtText,
  conversationId,
}: {
  messages: ChatMessageFromServer[];
  setMessages: (m: ChatMessageFromServer[]) => void;
  setIsStreaming: (b: boolean) => void;
  setCurrentThoughtText: (t: string) => void;
  conversationId: string;
}) {
  const messageRelationshipMapRef = useRef<Map<string, string>>(new Map());

  const buildHistory = useCallback(
    (all: ChatMessageFromServer[]): LLMMessage[] => {
      const core = all
        .filter((m) => m.content_type === 'user' || m.content_type === 'assistant')
        .filter((m) => !!m.content && m.content.trim().length > 0)
        .map((m) => ({
          role: m.content_type as 'user' | 'assistant',
          content: m.content,
        }));

      return core.slice(-CONTEXT_WINDOW);
    },
    [],
  );

  const submitMessage = useCallback(
    async (userText: string) => {
      if (!userText.trim()) return;

      // optimistic user message
      const optimisticUser: ChatMessageFromServer = {
        id: crypto.randomUUID(),
        content_type: 'user',
        content: userText,
        timestamp: new Date().toISOString(),
      };

      const nextMessages = [...messages, optimisticUser];
      setMessages(nextMessages);

      const historyPayload = buildHistory(nextMessages);

      setIsStreaming(true);
      setCurrentThoughtText(''); // reset thoughts per turn

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          messages: historyPayload, // <-- THIS is the key change
        }),
      });

      if (!res.body) {
        setIsStreaming(false);
        return;
      }

      // streaming reader (keep your existing logic if different)
      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      let assistantText = '';
      let thoughts = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);

        // expected server format:
        // {type:"thought", content:"..."} or {type:"token", content:"..."}
        const lines = chunk.split('\n').filter(Boolean);

        for (const line of lines) {
          try {
            const evt = JSON.parse(line);

            if (evt.type === 'thought') {
              thoughts += evt.content;
              setCurrentThoughtText(thoughts);
            }

            if (evt.type === 'token') {
              assistantText += evt.content;

              const assistantMsg: ChatMessageFromServer = {
                id: crypto.randomUUID(),
                content_type: 'assistant',
                content: assistantText,
                timestamp: new Date().toISOString(),
              };

              setMessages([...nextMessages, assistantMsg]);
            }
          } catch {
            // ignore non json noise
          }
        }
      }

      setIsStreaming(false);
    },
    [
      messages,
      setMessages,
      setIsStreaming,
      setCurrentThoughtText,
      conversationId,
      buildHistory,
    ],
  );

  return { submitMessage, messageRelationshipMapRef };
}
