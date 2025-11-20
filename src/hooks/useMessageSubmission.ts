// src/hooks/useMessageSubmission.ts
import { useCallback, useRef } from 'react';
import { ChatMessageFromServer } from '@/types/chat';
import { chatService } from '../app/api/services/chat';

type UseMessageSubmissionArgs = {
  message: string;
  currentAttachments?: any[];

  chatMessages: ChatMessageFromServer[];
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessageFromServer[]>>;

  setMessage?: (v: string) => void;
  setCurrentAttachments?: (v: any[]) => void;

  setIsStreaming?: (v: boolean) => void;
  setCurrentThoughtText?: (v: string) => void;

  setLastAssistantMessageId?: (id: string) => void;
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
  // Keep old ref used elsewhere in your UI
  const messageRelationshipMapRef = useRef<Map<string, string>>(new Map());

  const getMostRecentAssistantMessageId = useCallback(() => {
    const last = [...chatMessages]
      .reverse()
      .find((m) => m.content_type === 'assistant' && !m.failed);

    return (last as any)?.message_id || (last as any)?.id || null;
  }, [chatMessages]);

  const submitMessageInternal = useCallback(
    async (userText: string, isRetry: boolean = false) => {
      const text = (userText || '').trim();
      if (!text && currentAttachments.length === 0) return;

      // optimistic user message for immediate UI
      const optimisticUser: ChatMessageFromServer = {
        message_id: crypto.randomUUID(),
        content_type: 'user',
        content: text,
        timestamp: new Date().toISOString(),
        attachments: currentAttachments || [],
        is_call: false,
        failed: false,
        finish_reason: null,
        // keep retry counter if your UI reads it
        try_number: isRetry ? 2 : 1,
      } as any;

      setChatMessages((prev) => [...prev, optimisticUser]);

      // clear input
      setMessage?.('');
      setCurrentAttachments?.([]);

      setIsStreaming?.(true);
      setCurrentThoughtText?.('');

      try {
        const formData = new FormData();
        formData.append('message', text);

        const resp = await chatService.sendMessage(formData);

        // If your Edge Function returns thoughts and you later add it to the service,
        // this will show them automatically without changing UI.
        const thoughts = (resp as any)?.data?.thoughts;
        if (thoughts && typeof thoughts === 'string') {
          setCurrentThoughtText?.(thoughts);
        }

        const assistantMsg = resp.data.message;

        setChatMessages((prev) => [...prev, assistantMsg]);

        const asstId = (assistantMsg as any)?.message_id || (assistantMsg as any)?.id;
        if (asstId) {
          setLastAssistantMessageId?.(asstId);
          messageRelationshipMapRef.current.set(
            optimisticUser.message_id as any,
            asstId,
          );
        }
      } catch (err: any) {
        console.error('handleSubmit failed', err);

        const failedAssistant: ChatMessageFromServer = {
          message_id: crypto.randomUUID(),
          content_type: 'assistant',
          content: '',
          timestamp: new Date().toISOString(),
          attachments: [],
          is_call: false,
          failed: true,
          failedMessage:
            err?.message || 'Sorry, I could not generate a reply.',
          finish_reason: null,
          try_number: isRetry ? 2 : 1,
        } as any;

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

  // This is what Conversation/index.tsx expects
  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      await submitMessageInternal(message, false);
    },
    [message, submitMessageInternal],
  );

  const handleRetryMessage = useCallback(
    async (failedUserMessage: ChatMessageFromServer) => {
      const retryText = (failedUserMessage?.content || '').trim();
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
