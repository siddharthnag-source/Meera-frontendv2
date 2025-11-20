// src/hooks/useMessageSubmission.ts
import { useCallback, useRef } from 'react';
import type React from 'react';
import {
  ChatMessageFromServer,
  ChatMessageResponse,
  ChatAttachmentFromServer,
} from '@/types/chat';
import { chatService } from '../app/api/services/chat';

// currentAttachments coming from Conversation can be looser than server type
type CurrentAttachment = Partial<ChatAttachmentFromServer> & {
  file?: File;
};

type UseMessageSubmissionArgs = {
  message: string;
  currentAttachments?: CurrentAttachment[];

  chatMessages: ChatMessageFromServer[];
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessageFromServer[]>>;

  setMessage?: (v: string) => void;
  setCurrentAttachments?: (v: CurrentAttachment[]) => void;

  setIsStreaming?: (v: boolean) => void;
  setCurrentThoughtText?: (v: string) => void;

  setLastAssistantMessageId?: (id: string) => void;

  isSearchActive?: boolean;
  isSending?: boolean;
  setIsSending?: (v: boolean) => void;
  setJustSentMessage?: (v: boolean) => void;

  lastOptimisticMessageIdRef?: React.MutableRefObject<string | null>;

  // allow extra props without breaking build
  [key: string]: unknown;
};

type ChatMessageLocal = ChatMessageFromServer & {
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
  setIsSending,
  setJustSentMessage,
  lastOptimisticMessageIdRef,
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

      // Normalize attachments to strict server shape (no undefined fields)
      const safeAttachments: ChatAttachmentFromServer[] = currentAttachments
        .filter((a) => typeof a.url === 'string' && a.url.trim().length > 0)
        .map((a) => ({
          name: a.name ?? 'attachment',
          type: a.type ?? 'document',
          url: a.url ?? '',
          size: a.size,
          file: a.file,
        }));

      if (!text && safeAttachments.length === 0) return;

      setIsSending?.(true);
      setIsStreaming?.(true);
      setCurrentThoughtText?.('');

      const optimisticUser: ChatMessageLocal = {
        message_id: crypto.randomUUID(),
        content_type: 'user',
        content: text,
        timestamp: new Date().toISOString(),
        attachments: safeAttachments,
        is_call: false,
        failed: false,
        finish_reason: null,
        try_number: isRetry ? 2 : 1,
      };

      if (lastOptimisticMessageIdRef) {
        lastOptimisticMessageIdRef.current = optimisticUser.message_id;
      }

      setChatMessages((prev) => [...prev, optimisticUser]);

      setMessage?.('');
      setCurrentAttachments?.([]);

      try {
        const formData = new FormData();
        formData.append('message', text);

        const result: ChatMessageResponse = await chatService.sendMessage(formData);
        const assistantMsg = result.data.message;

        const thoughts = assistantMsg.thoughts || result.data.thoughts || '';
        if (thoughts.trim().length > 0) {
          setCurrentThoughtText?.(thoughts);
        }

        setChatMessages((prev) => [...prev, assistantMsg]);

        const assistantId = assistantMsg.message_id;
        setLastAssistantMessageId?.(assistantId);
        messageRelationshipMapRef.current.set(optimisticUser.message_id, assistantId);

        setJustSentMessage?.(true);
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
        setIsSending?.(false);
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
      setIsSending,
      setJustSentMessage,
      lastOptimisticMessageIdRef,
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
