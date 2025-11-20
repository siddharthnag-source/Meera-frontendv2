// src/hooks/useMessageSubmission.ts
import React, { useCallback, useMemo } from 'react';
import { chatService } from '@/app/api/services/chat';
import type {
  ChatMessageFromServer,
  ChatMessageResponse,
  ChatMessageResponseData,
  ChatAttachmentFromServer,
} from '@/types/chat';

type AttachmentInput = {
  name?: string;
  type: string;
  url: string;
  size?: number;
  file?: File;
};

export type UseMessageSubmissionArgs = {
  message: string;
  currentAttachments: AttachmentInput[];
  chatMessages: ChatMessageFromServer[];
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessageFromServer[]>>;
  isSending: boolean;
  setIsSending: (v: boolean) => void;
  setIsAssistantTyping: (v: boolean) => void;
  clearAllInput: () => void;
  setCurrentThoughtText?: (t: string) => void;
  setJustSentMessage?: () => void;
  messageRelationshipMapRef: React.MutableRefObject<Map<string, string>>;
  lastOptimisticMessageIdRef?: React.MutableRefObject<string | null>;
  // Allow Conversation/index.tsx to pass extra props without TS excess property errors.
  [key: string]: unknown;
};

type ChatSendResponseData = ChatMessageResponseData;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const useMessageSubmission = ({
  message,
  currentAttachments,
  chatMessages,
  setChatMessages,
  isSending,
  setIsSending,
  setIsAssistantTyping,
  clearAllInput,
  setCurrentThoughtText,
  setJustSentMessage,
  messageRelationshipMapRef,
  lastOptimisticMessageIdRef,
}: UseMessageSubmissionArgs) => {
  const getMostRecentAssistantMessageId = useCallback((): string | null => {
    for (let i = chatMessages.length - 1; i >= 0; i -= 1) {
      if (chatMessages[i].content_type === 'assistant') return chatMessages[i].message_id;
    }
    return null;
  }, [chatMessages]);

  const handleSubmit = useCallback(
    async (userTextOverride?: string) => {
      const userText = (userTextOverride ?? message).trim();
      if (!userText || isSending) return;

      setIsSending(true);
      setIsAssistantTyping(true);
      if (setJustSentMessage) setJustSentMessage();

      const nowIso = new Date().toISOString();
      const optimisticUserId = crypto.randomUUID();
      if (lastOptimisticMessageIdRef) lastOptimisticMessageIdRef.current = optimisticUserId;

      const mappedAttachments: ChatAttachmentFromServer[] = (currentAttachments ?? []).map((att) => ({
        name: att.name ?? 'attachment',
        type: att.type,
        url: att.url,
        size: att.size,
        file: att.file,
      }));

      const optimisticUserMessage: ChatMessageFromServer = {
        message_id: optimisticUserId,
        content_type: 'user',
        content: userText,
        timestamp: nowIso,
        attachments: mappedAttachments,
        is_call: false,
        failed: false,
        finish_reason: null,
        try_number: 1,
      };

      const optimisticAssistantId = crypto.randomUUID();
      messageRelationshipMapRef.current.set(optimisticUserId, optimisticAssistantId);

      const optimisticAssistantMessage: ChatMessageFromServer = {
        message_id: optimisticAssistantId,
        content_type: 'assistant',
        content: '',
        timestamp: nowIso,
        attachments: [],
        is_call: false,
        failed: false,
        finish_reason: null,
        try_number: 1,
      };

      setChatMessages((prev) => [...prev, optimisticUserMessage, optimisticAssistantMessage]);

      const formData = new FormData();
      formData.append('message', userText);

      try {
        if (setCurrentThoughtText) {
          setCurrentThoughtText('Orchestrating');
          await sleep(350);
          setCurrentThoughtText('Searching memories');
          await sleep(350);
          setCurrentThoughtText('Thinking');
        }

        const result: ChatMessageResponse = await chatService.sendMessage(formData);
        const rawData: ChatSendResponseData = result.data;

        const assistantText = rawData.response ?? '';
        const thoughtsText = rawData.thoughts ?? '';

        setChatMessages((prev) =>
          prev.map((m) =>
            m.message_id === optimisticAssistantId
              ? {
                  ...m,
                  content: assistantText,
                  failed: false,
                  failedMessage: undefined,
                  finish_reason: 'stop',
                }
              : m,
          ),
        );

        // After final answer, optionally render model thoughts as a separate assistant message.
        if (thoughtsText.trim().length > 0) {
          const thoughtsMsg: ChatMessageFromServer = {
            message_id: crypto.randomUUID(),
            content_type: 'assistant',
            content: thoughtsText,
            timestamp: new Date().toISOString(),
            attachments: [],
            is_call: false,
            failed: false,
            finish_reason: null,
          };
          setChatMessages((prev) => [...prev, thoughtsMsg]);
        }
      } catch (err) {
        console.error('useMessageSubmission.handleSubmit error:', err);

        setChatMessages((prev) =>
          prev.map((m) =>
            m.message_id === optimisticAssistantId
              ? {
                  ...m,
                  content: 'Sorry, I could not generate a reply.',
                  failed: true,
                  failedMessage: 'Request failed. Please retry.',
                }
              : m,
          ),
        );
      } finally {
        if (setCurrentThoughtText) setCurrentThoughtText('');
        setIsAssistantTyping(false);
        setIsSending(false);
        clearAllInput();
      }
    },
    [
      message,
      currentAttachments,
      isSending,
      setIsSending,
      setIsAssistantTyping,
      clearAllInput,
      setCurrentThoughtText,
      setJustSentMessage,
      setChatMessages,
      messageRelationshipMapRef,
      lastOptimisticMessageIdRef,
    ],
  );

  const handleRetryMessage = useCallback(
    async (failedAssistantMessage: ChatMessageFromServer) => {
      if (failedAssistantMessage.content_type !== 'assistant') return;

      let linkedUserId: string | undefined;
      for (const [userId, assistantId] of messageRelationshipMapRef.current.entries()) {
        if (assistantId === failedAssistantMessage.message_id) {
          linkedUserId = userId;
          break;
        }
      }
      if (!linkedUserId) return;

      const linkedUserMessage = chatMessages.find((m) => m.message_id === linkedUserId);
      if (!linkedUserMessage) return;

      await handleSubmit(linkedUserMessage.content);
    },
    [chatMessages, handleSubmit, messageRelationshipMapRef],
  );

  return useMemo(
    () => ({
      handleSubmit,
      handleRetryMessage,
      getMostRecentAssistantMessageId,
      messageRelationshipMapRef,
    }),
    [handleSubmit, handleRetryMessage, getMostRecentAssistantMessageId, messageRelationshipMapRef],
  );
};

export default useMessageSubmission;
