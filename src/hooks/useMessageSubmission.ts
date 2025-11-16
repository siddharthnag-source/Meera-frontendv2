'use client';

import { ApiError, chatService, SessionExpiredError } from '@/app/api/services/chat';
import { useToast } from '@/components/ui/ToastProvider';
import { createLocalTimestamp } from '@/lib/dateUtils';
import { getSystemInfo } from '@/lib/deviceInfo';
import { ChatAttachmentInputState, ChatMessageFromServer } from '@/types/chat';
import { PricingModalSource } from '@/types/pricing';
import React, { MutableRefObject, useCallback, useMemo, useRef } from 'react';
import { usePricingModal } from '../contexts/PricingModalContext';
import { useSubscriptionStatus } from './useSubscriptionStatus';

interface UseMessageSubmissionProps {
  message: string;
  currentAttachments: ChatAttachmentInputState[];
  chatMessages: ChatMessageFromServer[];
  isSearchActive: boolean;
  isSending: boolean;
  setIsSending: (isSending: boolean) => void;
  setJustSentMessage: (justSent: boolean) => void;
  setCurrentThoughtText: (text: string) => void;
  lastOptimisticMessageIdRef: MutableRefObject<string | null>;
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessageFromServer[]>>;
  setIsAssistantTyping: (isTyping: boolean) => void;
  clearAllInput: () => void;
  scrollToBottom: (smooth?: boolean) => void;
  onMessageSent?: () => void;
}

const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 100;

export const useMessageSubmission = ({
  message,
  currentAttachments,
  chatMessages,
  isSearchActive,
  isSending,
  setIsSending,
  setJustSentMessage,
  setCurrentThoughtText,
  lastOptimisticMessageIdRef,
  setChatMessages,
  setIsAssistantTyping,
  clearAllInput,
  scrollToBottom,
  onMessageSent,
}: UseMessageSubmissionProps) => {
  const { data: subscriptionData, refetch } = useSubscriptionStatus();
  const { openModal } = usePricingModal();
  const { showToast } = useToast();

  const messageRelationshipMapRef = useRef<Map<string, string>>(new Map());
  const mostRecentAssistantMessageIdRef = useRef<string | null>(null);

  const limitSource = useMemo((): PricingModalSource | null => {
    if (!subscriptionData) return null;

    const isPaid = subscriptionData.plan_type === 'paid';
    const hasActiveSub = new Date(subscriptionData.subscription_end_date || 0) >= new Date();
    const hasNoTokens = (subscriptionData.tokens_left ?? 0) <= 0;

    if (isPaid && !hasActiveSub) return 'paid_sub_expired';
    if (!isPaid) {
      if (hasNoTokens) return 'free_tokens_expired';
      if (!hasActiveSub) return 'free_trial_expired';
    }

    return null;
  }, [subscriptionData]);

  const cleanupAssistantMessage = useCallback(
    (userMessageId: string, preserveAssistantMessage: boolean = false) => {
      const assistantId = messageRelationshipMapRef.current.get(userMessageId);
      if (assistantId) {
        if (preserveAssistantMessage) {
          // Mark assistant message as failed but keep it in the UI
          setChatMessages((prev) =>
            prev.map((msg) =>
              msg.message_id === assistantId
                ? { ...msg, failed: true, content: '', failedMessage: 'Failed to respond, try again' }
                : msg,
            ),
          );
        } else {
          // Remove assistant message entirely
          setChatMessages((prev) => prev.filter((msg) => msg.message_id !== assistantId));
        }
      }
    },
    [setChatMessages],
  );

  const resetAssistantMessageForRetry = useCallback(
    (userMessageId: string) => {
      const assistantId = messageRelationshipMapRef.current.get(userMessageId);
      if (assistantId) {
        setChatMessages((prev) =>
          prev.map((msg) =>
            msg.message_id === assistantId ? { ...msg, failed: false, content: '', finish_reason: null } : msg,
          ),
        );
      } else {
        const newAssistantId = `assistant-${Date.now()}`;
        messageRelationshipMapRef.current.set(userMessageId, newAssistantId);
      }
    },
    [setChatMessages],
  );

  const clearMessageRelationshipMap = useCallback(() => {
    messageRelationshipMapRef.current.clear();
    mostRecentAssistantMessageIdRef.current = null;
  }, []);

  const createOptimisticMessage = useCallback(
    (
      optimisticId: string,
      messageText: string,
      attachments: ChatAttachmentInputState[],
      tryNumber: number,
    ): ChatMessageFromServer => {
      const lastMessage = chatMessages[chatMessages.length - 1];
      let newTimestamp = new Date();

      if (lastMessage && new Date(lastMessage.timestamp) >= newTimestamp) {
        newTimestamp = new Date(new Date(lastMessage.timestamp).getTime() + 6);
      }

      return {
        message_id: optimisticId,
        content: messageText,
        content_type: 'user',
        timestamp: createLocalTimestamp(newTimestamp),
        attachments: attachments.map((att) => ({
          name: att.file.name,
          type:
            att.file.type === 'application/pdf'
              ? 'pdf'
              : att.type === 'image'
                ? 'image'
                : att.file.type.split('/')[1] || 'file',
          url: att.previewUrl || '',
          size: att.file.size,
          file: att.file,
        })),
        try_number: tryNumber,
      };
    },
    [chatMessages],
  );

  const handleStreamResponse = useCallback(
    async (response: Response, optimisticId: string, tryNumber: number): Promise<void> => {
      if (!response.body) throw new Error('Response body is null');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let buffer = '';
      let assistantMessageId: string | null = null;
      let accumulatedContent = '';
      let streamCompletedSuccessfully = false;

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            if (!streamCompletedSuccessfully) {
              throw new Error('Stream ended without meera_finish signal');
            }
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;

            let data: Record<string, unknown>;
            try {
              data = JSON.parse(line) as Record<string, unknown>;
            } catch (err) {
              console.error('JSON parse error:', err, 'line:', line);
              throw new Error('Failed to parse streaming response');
            }

            if (data.meera_finish === true) {
              streamCompletedSuccessfully = true;
              continue;
            }

            if (data.is_thought) {
              setCurrentThoughtText(String(data.text ?? ''));
              continue;
            }

            const content = typeof data.text === 'string' ? data.text : '';

            if (!assistantMessageId) {
              assistantMessageId = messageRelationshipMapRef.current.get(optimisticId) || null;

              if (content) {
                setIsAssistantTyping(false);
                setCurrentThoughtText('');
              }
            }

            let cleanedContent = content;
            let imageUrl: string | null = null;

            if (content) {
              const imageUrlMatch = content.match(/\[([^\]]+)\]\(([^)]+)\)/);
              if (imageUrlMatch) {
                imageUrl = imageUrlMatch[2];
                cleanedContent = content.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '').trim();
              }
            }

            accumulatedContent += cleanedContent;

            setChatMessages((prev) => {
              if (!assistantMessageId) return prev;

              const existingMessage = prev.find((msg) => msg.message_id === assistantMessageId);
              let attachments = existingMessage?.attachments ?? [];

              if (imageUrl && imageUrl.match(/\.(png|jpg|jpeg|gif|webp)$/i)) {
                const already = attachments.some((att) => att.url === imageUrl);
                if (!already) {
                  attachments = [
                    ...attachments,
                    {
                      name: 'Generated Image',
                      type: 'image',
                      url: imageUrl,
                      size: 0,
                    },
                  ];
                }
              }

              const assistantMessage: ChatMessageFromServer = {
                message_id: assistantMessageId,
                content: accumulatedContent,
                content_type: 'assistant',
                timestamp: createLocalTimestamp(),
                attachments,
                finish_reason:
                  typeof data.finish_reason === 'string'
                    ? data.finish_reason
                    : existingMessage?.finish_reason ?? null,
                try_number: existingMessage?.try_number ?? tryNumber,
              };

              return prev.map((msg) =>
                msg.message_id === assistantMessageId ? assistantMessage : msg,
              );
            });
          }
        }
      } finally {
        reader.releaseLock();
      }
    },
    [setCurrentThoughtText, setIsAssistantTyping, setChatMessages],
  );

  const executeSubmission = useCallback(
    async (
      messageText: string,
      attachments: ChatAttachmentInputState[] = [],
      tryNumber = 1,
      optimisticIdToUpdate?: string,
      isFromManualRetry: boolean = false,
    ) => {
      if (isSending) {
        return;
      }

      const isRetry = !!optimisticIdToUpdate;

      if (limitSource) {
        const isClosable = limitSource === 'paid_sub_expired';
        openModal('plan_expired_still_messaging', isClosable);
        return;
      }

      const trimmedMessage = messageText.trim();
      if (!trimmedMessage && attachments.length === 0) return;

      const optimisticId = optimisticIdToUpdate || `optimistic-${Date.now()}`;

      if (isRetry) {
        // reset existing assistant + user message state
        resetAssistantMessageForRetry(optimisticId);
        setChatMessages((prev) =>
          prev.map((msg) => {
            if (msg.message_id === optimisticId) {
              return { ...msg, failed: false, try_number: tryNumber };
            }
            const assistantId = messageRelationshipMapRef.current.get(optimisticId);
            if (assistantId && msg.message_id === assistantId) {
              return { ...msg, failed: false, content: '', finish_reason: null, try_number: tryNumber };
            }
            return msg;
          }),
        );

        if (isFromManualRetry) {
          setTimeout(() => scrollToBottom(true), 150);
        }
      } else {
        const userMessage = createOptimisticMessage(optimisticId, trimmedMessage, attachments, tryNumber);
        const assistantMessageId = `assistant-${Date.now()}`;
        const emptyAssistantMessage: ChatMessageFromServer = {
          message_id: assistantMessageId,
          content: '',
          content_type: 'assistant',
          timestamp: createLocalTimestamp(),
          attachments: [],
          try_number: tryNumber,
        };

        messageRelationshipMapRef.current.set(optimisticId, assistantMessageId);
        mostRecentAssistantMessageIdRef.current = assistantMessageId;

        setChatMessages((prevMessages) => [...prevMessages, userMessage, emptyAssistantMessage]);

        clearAllInput();
        onMessageSent?.();
        setTimeout(() => scrollToBottom(true), 300);
      }

      setIsSending(true);
      setJustSentMessage(true);
      setCurrentThoughtText('');
      lastOptimisticMessageIdRef.current = optimisticId;
      setIsAssistantTyping(true);

      const formData = new FormData();
      if (trimmedMessage) formData.append('message', trimmedMessage);
      attachments.forEach((att) => formData.append('files', att.file, att.file.name));
      if (isSearchActive) formData.append('google_search', 'true');
      formData.append('streaming', 'true');
      formData.append('thinking', 'true');
      formData.append('try_number', tryNumber.toString());

      const systemInfo = await getSystemInfo();
      if (systemInfo.device) formData.append('device', systemInfo.device);
      if (systemInfo.location) formData.append('location', systemInfo.location);
      if (systemInfo.network) formData.append('network', systemInfo.network);

      try {
        const response = await chatService.sendMessage(formData);

        if (!(response instanceof Response)) {
          throw new Error('Expected streaming response');
        }

        if (!response.ok) {
          if (response.status === 400) {
            const errorText = await response.text().catch(() => '');
            console.error('400 error body:', errorText);

            showToast('Unsupported File', { type: 'error', position: 'conversation' });
            setChatMessages((prev) =>
              prev.map((msg) => (msg.message_id === optimisticId ? { ...msg, failed: true } : msg)),
            );
            cleanupAssistantMessage(optimisticId, true);
            return;
          }

          const errorText = await response.text().catch(() => '');
          throw new ApiError(`API error: ${response.status}`, response.status, { detail: errorText });
        }

        await handleStreamResponse(response, optimisticId, tryNumber);
        refetch();
      } catch (error) {
        if (error instanceof SessionExpiredError) {
          setChatMessages((prev) =>
            prev.map((msg) => (msg.message_id === optimisticId ? { ...msg, failed: true } : msg)),
          );
          cleanupAssistantMessage(optimisticId, true);
          return;
        }

        if (error instanceof ApiError && error.status === 400) {
          cleanupAssistantMessage(optimisticId, true);
          return;
        }

        const attemptStartTryNumber = isFromManualRetry ? tryNumber - ((tryNumber - 1) % MAX_RETRY_ATTEMPTS) : 1;
        const maxRetriesForThisAttempt = attemptStartTryNumber + MAX_RETRY_ATTEMPTS - 1;

        if (tryNumber < maxRetriesForThisAttempt) {
          resetAssistantMessageForRetry(optimisticId);
          setTimeout(() => {
            executeSubmission(trimmedMessage, attachments, tryNumber + 1, optimisticId, isFromManualRetry);
          }, RETRY_DELAY_MS);
          return;
        }

        setChatMessages((prev) =>
          prev.map((msg) => (msg.message_id === optimisticId ? { ...msg, failed: true } : msg)),
        );
        cleanupAssistantMessage(optimisticId, true);

        console.error('Error sending message:', error);
      } finally {
        setIsSending(false);
        setIsAssistantTyping(false);
        setCurrentThoughtText('');
        lastOptimisticMessageIdRef.current = null;
      }
    },
    [
      isSending,
      limitSource,
      openModal,
      isSearchActive,
      resetAssistantMessageForRetry,
      setChatMessages,
      createOptimisticMessage,
      clearAllInput,
      scrollToBottom,
      setIsSending,
      setJustSentMessage,
      setCurrentThoughtText,
      lastOptimisticMessageIdRef,
      setIsAssistantTyping,
      handleStreamResponse,
      refetch,
      onMessageSent,
      showToast,
      cleanupAssistantMessage,
    ],
  );

  const handleRetryMessage = useCallback(
    (failedMessage: ChatMessageFromServer) => {
      const messageContent = failedMessage.content;
      const messageAttachments = failedMessage.attachments || [];
      const currentTryNumber = failedMessage.try_number || 0;
      const nextTryNumber = currentTryNumber + 1;
      const failedMessageId = failedMessage.message_id;

      const retryAttachments: ChatAttachmentInputState[] = messageAttachments
        .filter((att) => att.file)
        .map((att) => {
          const file = att.file as File;
          const blob = file.slice(0, file.size, file.type);
          const newFile = new File([blob], file.name, { type: file.type });
          return {
            file: newFile,
            previewUrl: att.url,
            type: att.type === 'image' ? 'image' : 'document',
          };
        });

      resetAssistantMessageForRetry(failedMessageId);
      setChatMessages((prev) =>
        prev.map((msg) =>
          msg.message_id === failedMessageId ? { ...msg, failed: false, try_number: nextTryNumber } : msg,
        ),
      );

      if (messageContent || retryAttachments.length > 0) {
        executeSubmission(messageContent, retryAttachments, nextTryNumber, failedMessageId, true);
      }
    },
    [executeSubmission, setChatMessages, resetAssistantMessageForRetry],
  );

  const handleSubmit = useCallback(
    (e: React.SyntheticEvent) => {
      e.preventDefault();
      executeSubmission(message, currentAttachments);
    },
    [executeSubmission, message, currentAttachments],
  );

  const getMostRecentAssistantMessageId = useCallback(() => {
    return mostRecentAssistantMessageIdRef.current;
  }, []);

  return {
    handleSubmit,
    executeSubmission,
    handleRetryMessage,
    getMostRecentAssistantMessageId,
    clearMessageRelationshipMap,
  };
};
