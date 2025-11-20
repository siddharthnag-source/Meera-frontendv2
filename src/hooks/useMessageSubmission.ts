// src/hooks/useMessageSubmission.ts
import { useCallback, useRef } from 'react';
import { ChatMessageFromServer, ChatMessageResponse } from '@/types/chat';
import { chatService } from '../app/api/services/chat';

type Attachment = {
  type?: string;
  url?: string;
  name?: string;
  size?: number;
};

type UseMessageSubmissionArgs = {
  message: string;
  currentAttachments?: Attachment[];

  chatMessages: ChatMessageFromServer[];
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessageFromServer[]>>;

  setMessage?: (v: string) => void;
  setCurrentAttachments?: (v: Attachment[]) => void;

  setIsStreaming?: (v: boolean) => void;
  setCurrentThoughtText?: (v: string) => void;

  setLastAssistantMessageId?: (id: string) => void;
};

// Local extension for optimistic fields your UI may use
type ChatMessageLocal = ChatMessageFromServer & {
  message_id: string;
  try_number?: number;
  failedMessage?: string;
};

export function useMessageSubmission({
  message,
  currentAttachments = [],
  chatMessages,
  setChatMessages,
  setMessage,
  setCurrentAttachments,
  setIsStreaming,
  setCurrentThoughtText,
  setLastAssistantMessageId,
}: UseMessageSubmissionArgs) {
  const messageRelationshipMapRef = useRef<Map<string, string>>(new Map());

  const getMostRecentAssistantMessageId = useCallback((): string | null => {
    const lastAssistant = [...chatMessages]
      .reverse()
      .find((m) => m.content_type === 'assistant' && !m.failed);

    return lastAssistant?.message_id ?? null;
  }, [chatMessages]);

  const submitMessageInternal = useCallback(
    async (userText: string, isRetry: boolean) => {
      const text = (userText || '').trim();
      if (!text && currentAttachments.length === 0) return;

      const optimisticUser: ChatMessageLocal = {
        message_id: crypto.randomUUID(),
        content_type: 'user',
        content: text,
        timestamp: new Date().toISOString(),
        attachments: currentAttachments,
        is_call: false,
        failed: false,
        finish_reason: null,
        try_number: isRetry ? 2 : 1,
      };

      setChatMessages((prev) => [...prev, optimisticUser]);

      setMessage?.('');
      setCurrentAttachments?.([]);

      setIsStreaming?.(true);
      setCurrentThoughtText?.('');

      try {
        const formData = new FormData();
        formData.append('message', text);

        const resp: ChatMessageResponse = await chatService.sendMessage(formData);

        // thoughts are returned by edge function, pass through if present
        const thoughtsMaybe = (resp as unknown as { data?: { thoughts?: string } })?.data?.thoughts;
        if (typeof thoughtsMaybe === 'string' && thoughtsMaybe.trim().length > 0) {
          setCurrentThoughtText?.(thoughtsMaybe);
        }

        const assistantMsg = resp.data.message;

        setChatMessages((prev) => [...prev, assistantMsg]);

        const assistantId = assistantMsg.message_id;
        if (assistantId) {
          setLastAssistantMessageId?.(assistantId);
          messageRelationshipMapRef.current.set(optimisticUser.message_id, assistantId);
        }
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Sorry, I could not generate a reply.';

        const failedAssistant: ChatMessageLocal = {
          message_id: crypto.randomUUID(),
          content_type: 'assistant',
          content: '',
          timestamp: new Date().toISOString(),
          attachments: [],
          is_call: false,
          failed: true,
          failedMessage: errorMessage,
          finish_reason: null,
          try_number: isRetry ? 2 : 1,
        };

        setChatMessages((prev) => [...prev, failedAssistant]);
      } finally {
        setIsStreaming?.(false);
      }
    },
    [
      currentAttachments,
      setChatMessages,
      setMessage,
      setCurrentAttachments,
      setIsStreaming,
      setCurrentThoughtText,
      setLastAssistantMessageId,
    ],
  );

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      await submitMessageInternal(message, false);
    },
    [message, submitMessageInternal],
  );

  const handleRetryMessage = useCallback(
    async (failedUserMessage: ChatMessageFromServer) => {
      const retryText = (failedUserMessage.content || '').trim();
      if (!retryText) return;
      await submitMessageInternal(retryText, true);
    },
    [submitMessageInternal],
  );

  return {
    handleSubmit,
    handleRetryMessage,
    getMostRecentAssistantMessageId,
    messageRelationshipMapRef,
  };
}
