'use client';

import { chatService } from '@/app/api/services/chat';
import { useToast } from '@/components/ui/ToastProvider';
import { createLocalTimestamp } from '@/lib/dateUtils';
import {
  ChatAttachmentInputState,
  ChatMessageFromServer,
} from '@/types/chat';
import React, { MutableRefObject, useCallback, useRef } from 'react';

interface UseMessageSubmissionProps {
  message: string;
  currentAttachments: ChatAttachmentInputState[];
  chatMessages: ChatMessageFromServer[];
  isSearchActive: boolean; // kept for future use if you want to include search flag in payload
  isSending: boolean;
  setIsSending: (isSending: boolean) => void;
  setJustSentMessage: (justSent: boolean) => void;
  setCurrentThoughtText: (text: string) => void;
  lastOptimisticMessageIdRef: MutableRefObject<string | null>;
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessageFromServer[]>>;
  setIsAssistantTyping: (isTyping: boolean) => void;
  clearAllInput: () => void;
  scrollToBottom: (smooth?: boolean, force?: boolean) => void;
  onMessageSent?: () => void;
}

export const useMessageSubmission = ({
  message,
  currentAttachments,
  chatMessages,
  isSearchActive, // currently unused here but kept for compatibility
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
        newTimestamp = new Date(
          new Date(lastMessage.timestamp).getTime() + 6,
        );
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
              : att.file.type || 'file',
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
      const hasText = trimmedMessage.length > 0;
      const hasAttachments = attachments.length > 0;

      if (!hasText && !hasAttachments) return;

      const optimisticId = optimisticIdToUpdate || `optimistic-${Date.now()}`;

      // New send: create user + assistant placeholders
      if (!optimisticIdToUpdate) {
        const userMessage = createOptimisticMessage(
          optimisticId,
          trimmedMessage,
          attachments,
        );

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

        setTimeout(() => scrollToBottom(true, true), 150);
      } else {
        // Retry: clear failed state on the user message
        setChatMessages((prev) =>
          prev.map((msg) =>
            msg.message_id === optimisticId
              ? { ...msg, failed: false, try_number: tryNumber }
              : msg,
          ),
        );
      }

      setIsSending(true);
      setJustSentMessage(true);
      setCurrentThoughtText('');
      lastOptimisticMessageIdRef.current = optimisticId;
      setIsAssistantTyping(true);

      // Build attachment metadata for Gemini
      const attachmentMeta = attachments
        .filter((att) => att.storagePath) // only ones that have been uploaded
        .map((att) => ({
          name: att.file.name,
          type: att.type, // 'image' | 'document'
          mimeType: att.file.type,
          size: att.file.size,
          storagePath: att.storagePath,
        }));

      // Wrap message + attachments into a Meera payload if there are files
      const payloadMessage =
        attachmentMeta.length > 0
          ? JSON.stringify({
              __meera_payload: 'v1',
              text: trimmedMessage,
              attachments: attachmentMeta,
              // you can also tuck search flag here later if you want
            })
          : trimmedMessage;

      const assistantId =
        messageRelationshipMapRef.current.get(optimisticId);

      try {
        let fullAssistantText = '';

        await chatService.streamMessage({
          message: payloadMessage,
          onDelta: (delta) => {
            fullAssistantText += delta;
            if (!assistantId) return;

            setChatMessages((prev) =>
              prev.map((msg) =>
                msg.message_id === assistantId
                  ? {
                      ...msg,
                      content: (msg.content || '') + delta,
                      failed: false,
                      try_number: tryNumber,
                    }
                  : msg,
              ),
            );
          },
          onDone: () => {
            if (!assistantId) return;

            setChatMessages((prev) =>
              prev.map((msg) =>
                msg.message_id === assistantId
                  ? {
                      ...msg,
                      content: msg.content || fullAssistantText,
                      failed: false,
                      try_number: tryNumber,
                    }
                  : msg,
              ),
            );
          },
          onError: (err) => {
            // We rethrow so the outer catch handles the UI state
            throw err;
          },
        });

        return;
      } catch (error) {
        console.error('Error sending message:', error);

        showToast('Failed to respond, try again', {
          type: 'error',
          position: 'conversation',
        });

        setChatMessages((prev) =>
          prev.map((msg) => {
            if (msg.message_id === optimisticId)
              return { ...msg, failed: true };
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
      } finally {
        setIsSending(false);
        setIsAssistantTyping(false);
        lastOptimisticMessageIdRef.current = null;

        if (isFromManualRetry) {
          setTimeout(() => scrollToBottom(true, true), 150);
        }
      }
    },
    [
      isSending,
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

      // Recreate attachment input state from stored attachments
      const retryAttachments: ChatAttachmentInputState[] =
        messageAttachments
          .filter((att) => att.file)
          .map((att) => {
            const file = att.file as File;
            const blob = file.slice(0, file.size, file.type);
            const newFile = new File([blob], file.name, { type: file.type });
            return {
              file: newFile,
              previewUrl: att.url,
              type:
                att.type === 'image' || att.type === 'document'
                  ? (att.type as 'image' | 'document')
                  : file.type === 'application/pdf'
                  ? 'document'
                  : 'image',
              // storagePath will be added again by the upload flow
            };
          });

      if (messageContent || retryAttachments.length > 0) {
        executeSubmission(
          messageContent,
          retryAttachments,
          nextTryNumber,
          failedMessageId,
          true,
        );
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
