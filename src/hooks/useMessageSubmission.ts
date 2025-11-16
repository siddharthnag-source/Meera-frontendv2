'use client';

import { ApiError, chatService, SessionExpiredError } from '@/app/api/services/chat';
import { useToast } from '@/components/ui/ToastProvider';
import { createLocalTimestamp } from '@/lib/dateUtils';
import { getSystemInfo } from '@/lib/deviceInfo';
import { ChatAttachmentInputState, ChatMessageFromServer } from '@/types/chat';
import React, { MutableRefObject, useCallback, useRef } from 'react';

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
  const { showToast } = useToast();

  // userMessageId -> assistantMessageId
  const messageRelationshipMapRef = useRef<Map<string, string>>(new Map());
  const mostRecentAssistantMessageIdRef = useRef<string | null>(null);

  const createOptimisticMessage = useCallback(
    (
      optimisticId: string,
      messageText: string,
      attachments: ChatAttachmentInputState[],
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
        try_number: 1,
      };
    },
    [chatMessages],
  );

  const clearMessageRelationshipMap = useCallback(() => {
    messageRelationshipMapRef.current.clear();
    mostRecentAssistantMessageIdRef.current = null;
  }, []);

  const executeSubmission = useCallback(
    async (
      messageText: string,
      attachments: ChatAttachmentInputState[] = [],
      tryNumber: number = 1,
      optimisticIdToUpdate?: string,
      isFromManualRetry: boolean = false,
    ) => {
      if (isSending) return;

      const trimmedMessage = messageText.trim();
      if (!trimmedMessage && attachments.length === 0) return;

      const optimisticId = optimisticIdToUpdate || `optimistic-${Date.now()}`;

      // If not a retry, create user + empty assistant messages
      if (!optimisticIdToUpdate) {
        const userMessage = createOptimisticMessage(optimisticId, trimmedMessage, attachments);

        const assistantMessageId = `assistant-${Date.now()}`;
        const emptyAssistantMessage: ChatMessageFromServer = {
          message_id: assistantMessageId,
          content: '',
          content_type: 'assistant',
          timestamp: createLocalTimestamp(),
          attachments: [],
          try_number: tryNumber,
          failed: false,
        };

        messageRelationshipMapRef.current.set(optimisticId, assistantMessageId);
        mostRecentAssistantMessageIdRef.current = assistantMessageId;

        setChatMessages((prev) => [...prev, userMessage, emptyAssistantMessage]);

        clearAllInput();
        onMessageSent?.();
        setTimeout(() => scrollToBottom(true), 300);
      } else {
        // Retry: clear failed state
        setChatMessages((prev) =>
          prev.map((msg) =>
            msg.message_id === optimisticId ? { ...msg, failed: false, try_number: tryNumber } : msg,
          ),
        );
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

      const systemInfo = await getSystemInfo();
      if (systemInfo.device) formData.append('device', systemInfo.device);
      if (systemInfo.location) formData.append('location', systemInfo.location);
      if (systemInfo.network) formData.append('network', systemInfo.network);

      try {
        const result = await chatService.sendMessage(formData);
        const assistantText = result.data.response;

        const assistantId = messageRelationshipMapRef.current.get(optimisticId);

        setIsAssistantTyping(false);
        setCurrentThoughtText('');

        if (assistantId) {
          setChatMessages((prev) =>
            prev.map((msg) =>
              msg.message_id === assistantId
                ? {
                    ...msg,
                    content: assistantText,
                    timestamp: createLocalTimestamp(),
                    failed: false,
                    try_number: tryNumber,
                  }
                : msg,
            ),
          );
        }
      } catch (error) {
        console.error('Error sending message:', error);

        if (error instanceof SessionExpiredError) {
          setChatMessages((prev) =>
            prev.map((msg) =>
              msg.message_id === optimisticId ? { ...msg, failed: true } : msg,
            ),
          );
        } else if (error instanceof ApiError && error.status === 400) {
          showToast('Unsupported file', { type: 'error', position: 'conversation' });
          setChatMessages((prev) =>
            prev.map((msg) =>
              msg.message_id === optimisticId ? { ...msg, failed: true } : msg,
            ),
          );
        } else {
          showToast('Failed to respond, try again', { type: 'error', position: 'conversation' });

          const assistantId = messageRelationshipMapRef.current.get(optimisticId);

          setChatMessages((prev) =>
            prev.map((msg) => {
              if (msg.message_id === optimisticId) {
                return { ...msg, failed: true };
              }
              if (assistantId && msg.message_id === assistantId) {
                return {
                  ...msg,
                  failed: true,
                  failedMessage: 'Failed to respond, try again',
                };
              }
              return msg;
            }),
          );
        }
      } finally {
        setIsSending(false);
        setIsAssistantTyping(false);
        setCurrentThoughtText('');
        lastOptimisticMessageIdRef.current = null;

        if (isFromManualRetry) {
          setTimeout(() => scrollToBottom(true), 150);
        }
      }
    },
    [
      isSending,
      isSearchActive,
      createOptimisticMessage,
      setChatMessages,
      clearAllInput,
      scrollToBottom,
      setIsSending,
      setJustSentMessage,
      setCurrentThoughtText,
      lastOptimisticMessageIdRef,
      setIsAssistantTyping,
      showToast,
      onMessageSent,
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

      if (messageContent || retryAttachments.length > 0) {
        executeSubmission(messageContent, retryAttachments, nextTryNumber, failedMessageId, true);
      }
    },
    [executeSubmission],
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
