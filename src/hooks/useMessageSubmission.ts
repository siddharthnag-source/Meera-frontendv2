'use client';

import { ApiError, chatService, SessionExpiredError } from '@/app/api/services/chat';
import { useToast } from '@/components/ui/ToastProvider';
import { createLocalTimestamp } from '@/lib/dateUtils';
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

  // Map user-message-id -> assistant-message-id
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
      };
    },
    [chatMessages],
  );

  const clearMessageRelationshipMap = useCallback(() => {
    messageRelationshipMapRef.current.clear();
    mostRecentAssistantMessageIdRef.current = null;
  }, []);

  const markMessageFailed = useCallback(
    (userMessageId: string) => {
      const assistantId = messageRelationshipMapRef.current.get(userMessageId);

      setChatMessages((prev) =>
        prev.map((msg) => {
          if (msg.message_id === userMessageId) {
            return { ...msg, failed: true };
          }
          if (assistantId && msg.message_id === assistantId) {
            return {
              ...msg,
              failed: true,
              content: '',
              failedMessage: 'Failed to respond, try again',
            };
          }
          return msg;
        }),
      );
    },
    [setChatMessages],
  );

  const executeSubmission = useCallback(
    async (
      messageText: string,
      attachments: ChatAttachmentInputState[] = [],
      userMessageIdOverride?: string,
      isRetry: boolean = false,
    ) => {
      if (isSending) return;

      const trimmedMessage = messageText.trim();
      if (!trimmedMessage && attachments.length === 0) return;

      const optimisticId = userMessageIdOverride || `optimistic-${Date.now()}`;

      // optimistic UI
      if (isRetry) {
        // clear failed flags and assistant content
        const assistantId = messageRelationshipMapRef.current.get(optimisticId);
        setChatMessages((prev) =>
          prev.map((msg) => {
            if (msg.message_id === optimisticId) {
              return { ...msg, failed: false };
            }
            if (assistantId && msg.message_id === assistantId) {
              return { ...msg, failed: false, content: '' };
            }
            return msg;
          }),
        );
      } else {
        const userMessage = createOptimisticMessage(optimisticId, trimmedMessage, attachments);
        const assistantMessageId = `assistant-${Date.now()}`;

        const emptyAssistantMessage: ChatMessageFromServer = {
          message_id: assistantMessageId,
          content: '',
          content_type: 'assistant',
          timestamp: createLocalTimestamp(),
          attachments: [],
        };

        messageRelationshipMapRef.current.set(optimisticId, assistantMessageId);
        mostRecentAssistantMessageIdRef.current = assistantMessageId;

        setChatMessages((prev) => [...prev, userMessage, emptyAssistantMessage]);
        clearAllInput();
        onMessageSent?.();
        setTimeout(() => scrollToBottom(true), 300);
      }

      setIsSending(true);
      setJustSentMessage(true);
      setIsAssistantTyping(true);
      setCurrentThoughtText('');
      lastOptimisticMessageIdRef.current = optimisticId;

      // prepare payload for chatService
      const formData = new FormData();
      if (trimmedMessage) formData.append('message', trimmedMessage);
      attachments.forEach((att) => formData.append('files', att.file, att.file.name));
      if (isSearchActive) formData.append('google_search', 'true');

      try {
        const response = await chatService.sendMessage(formData); // ChatMessageResponse

        const assistantId = messageRelationshipMapRef.current.get(optimisticId);
        if (!assistantId) {
          console.warn('No assistant message id mapped for', optimisticId);
          return;
        }

        const data = response.data as any;
        const serverAssistant: ChatMessageFromServer | undefined = data?.message;
        const textResponse: string = data?.response ?? '';

        setChatMessages((prev) =>
          prev.map((msg) => {
            if (msg.message_id !== assistantId) return msg;

            if (serverAssistant) {
              // keep our assistant id, overwrite content and meta from server
              return {
                ...msg,
                ...serverAssistant,
                message_id: assistantId,
                failed: false,
              };
            }

            return {
              ...msg,
              content: textResponse || msg.content,
              failed: false,
            };
          }),
        );
      } catch (error) {
        console.error('Error sending message:', error);

        if (error instanceof SessionExpiredError) {
          showToast('Session expired. Please sign in again.', {
            type: 'error',
            position: 'conversation',
          });
          markMessageFailed(optimisticId);
        } else if (error instanceof ApiError) {
          showToast(error.body?.detail || 'Something went wrong. Please try again.', {
            type: 'error',
            position: 'conversation',
          });
          markMessageFailed(optimisticId);
        } else {
          showToast('Network error. Please check your connection and try again.', {
            type: 'error',
            position: 'conversation',
          });
          markMessageFailed(optimisticId);
        }
      } finally {
        setIsSending(false);
        setIsAssistantTyping(false);
        setCurrentThoughtText('');
        lastOptimisticMessageIdRef.current = null;
      }
    },
    [
      isSending,
      isSearchActive,
      setIsSending,
      setJustSentMessage,
      setIsAssistantTyping,
      setCurrentThoughtText,
      lastOptimisticMessageIdRef,
      setChatMessages,
      clearAllInput,
      scrollToBottom,
      onMessageSent,
      createOptimisticMessage,
      showToast,
      markMessageFailed,
    ],
  );

  const handleRetryMessage = useCallback(
    (failedMessage: ChatMessageFromServer) => {
      const messageContent = failedMessage.content;
      const messageAttachments = failedMessage.attachments || [];

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

      if (!messageContent && retryAttachments.length === 0) return;

      executeSubmission(messageContent, retryAttachments, failedMessage.message_id, true);
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
