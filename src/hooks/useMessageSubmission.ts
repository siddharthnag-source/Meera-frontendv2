'use client';

import { chatService } from '@/app/api/services/chat';
import { useToast } from '@/components/ui/ToastProvider';
import { createLocalTimestamp } from '@/lib/dateUtils';
import { supabase } from '@/lib/supabaseClient';
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
  onMessageSent?: () => void;
}

const ATTACHMENTS_BUCKET = 'attachments';

type UploadedMeta = {
  storagePath: string;
  publicUrl: string;
  name: string;
  mimeType: string;
  size: number;
  type: 'image' | 'document';
};

async function uploadAttachmentToStorage(
  file: File,
  type: 'image' | 'document',
): Promise<UploadedMeta> {
  const ext = file.name.includes('.') ? file.name.split('.').pop() || '' : '';
  const randomSuffix = Math.random().toString(36).slice(2);
  const path = `${Date.now()}-${randomSuffix}${ext ? '.' + ext : ''}`;

  const { error: uploadError } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false });

  if (uploadError) {
    console.error('Supabase upload error', uploadError);
    throw uploadError;
  }

  const { data } = supabase.storage.from(ATTACHMENTS_BUCKET).getPublicUrl(path);
  const publicUrl = data?.publicUrl || '';
  if (!publicUrl) throw new Error('Failed to obtain public URL from Supabase');

  return {
    storagePath: path,
    publicUrl,
    name: file.name,
    mimeType: file.type,
    size: file.size,
    type,
  };
}

export const useMessageSubmission = ({
  message,
  currentAttachments,
  chatMessages,
  isSending,
  setIsSending,
  setJustSentMessage,
  setCurrentThoughtText,
  lastOptimisticMessageIdRef,
  setChatMessages,
  setIsAssistantTyping,
  clearAllInput,
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
              ? 'document'
              : att.type === 'image'
              ? 'image'
              : 'file',
          url: att.publicUrl || att.previewUrl || '',
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

  /**
   * IMPORTANT: do NOT replace the whole chat array after streaming.
   * That replacement is a common cause of scroll jumps when images appear.
   *
   * Instead, reconcile only the last optimistic user + assistant placeholder
   * with the latest server user + assistant messages.
   */
  const refreshLatestMessagesFromServer = useCallback(
    async (optimisticUserId: string, assistantPlaceholderId: string) => {
      try {
        const res = await chatService.getChatHistory(1);
        if (!res?.data || res.data.length === 0) return;

        const raw = res.data as ChatMessageFromServer[];
        const serverMessages = raw
          .map((m) => ({ ...m, attachments: m.attachments ?? [] }))
          .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

        const latestServerUser = [...serverMessages]
          .reverse()
          .find((m) => m.content_type === 'user' && !m.is_call);

        const latestServerAssistant = [...serverMessages]
          .reverse()
          .find((m) => m.content_type === 'assistant' && !m.is_call);

        setChatMessages((prev) => {
          let next = prev.map((m) => {
            if (m.message_id === optimisticUserId && latestServerUser) return latestServerUser;
            if (m.message_id === assistantPlaceholderId && latestServerAssistant)
              return latestServerAssistant;
            return m;
          });

          const seen = new Set<string>();
          next = next.filter((m) => {
            if (seen.has(m.message_id)) return false;
            seen.add(m.message_id);
            return true;
          });

          const have = new Set(next.map((m) => m.message_id));
          const toAdd = serverMessages.filter((m) => !have.has(m.message_id));

          if (toAdd.length > 0) {
            next = [...next, ...toAdd].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
          }

          return next;
        });
      } catch (err) {
        console.error('Failed to refresh messages after send:', err);
      }
    },
    [setChatMessages],
  );

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

      let uploaded: UploadedMeta[] = [];
      if (hasAttachments) {
        try {
          uploaded = await Promise.all(
            attachments.map((att) => uploadAttachmentToStorage(att.file, att.type)),
          );
        } catch (uploadErr) {
          console.error('Upload failed', uploadErr);
          showToast('Failed to upload file(s). Please try again.', {
            type: 'error',
            position: 'conversation',
          });
          return;
        }
      }

      const attachmentsWithStorage: ChatAttachmentInputState[] = attachments.map((att, idx) => {
        const meta = uploaded[idx];
        if (!meta) return att;
        return { ...att, storagePath: meta.storagePath, publicUrl: meta.publicUrl };
      });

      const optimisticId = optimisticIdToUpdate || `optimistic-${Date.now()}`;

      // STEP 2: optimistic user + assistant placeholders
      if (!optimisticIdToUpdate) {
        const userMessage = createOptimisticMessage(
          optimisticId,
          trimmedMessage,
          attachmentsWithStorage,
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
      } else {
        setChatMessages((prev) =>
          prev.map((m) =>
            m.message_id === optimisticId ? { ...m, failed: false, try_number: tryNumber } : m,
          ),
        );
      }

      setIsSending(true);
      setJustSentMessage(true);
      setCurrentThoughtText('');
      lastOptimisticMessageIdRef.current = optimisticId;
      setIsAssistantTyping(true);

      // STEP 3: payload text
      let payloadMessage = trimmedMessage;
      if (uploaded.length > 0) {
        const lines = uploaded.map(
          (meta) => `- ${meta.name} (${meta.mimeType}, ${meta.size} bytes): ${meta.publicUrl}`,
        );
        payloadMessage = [trimmedMessage, '', 'Attached files (public URLs, please open and read them):', ...lines]
          .filter(Boolean)
          .join('\n');
      }

      const assistantId = messageRelationshipMapRef.current.get(optimisticId);

      try {
        let fullAssistantText = '';

        await chatService.streamMessage({
          message: payloadMessage,
          onDelta: (delta) => {
            fullAssistantText += delta;
            if (!assistantId) return;

            setChatMessages((prev) =>
              prev.map((m) =>
                m.message_id === assistantId
                  ? {
                      ...m,
                      content: (m.content || '') + delta,
                      failed: false,
                      try_number: tryNumber,
                    }
                  : m,
              ),
            );
          },
          onDone: async () => {
            if (assistantId) {
              setChatMessages((prev) =>
                prev.map((m) =>
                  m.message_id === assistantId
                    ? {
                        ...m,
                        content: m.content || fullAssistantText,
                        failed: false,
                        try_number: tryNumber,
                      }
                    : m,
                ),
              );
            }

            // Pull server attachments without replacing the whole chat array
            if (assistantId) {
              await refreshLatestMessagesFromServer(optimisticId, assistantId);
            }
          },
          onError: (err) => {
            throw err;
          },
        });

        return;
      } catch (error) {
        console.error('Error sending message:', error);

        showToast('Failed to respond, try again', { type: 'error', position: 'conversation' });

        setChatMessages((prev) =>
          prev.map((m) => {
            if (m.message_id === optimisticId) return { ...m, failed: true };
            if (assistantId && m.message_id === assistantId) {
              return { ...m, failed: true, failedMessage: 'Failed to respond, try again' };
            }
            return m;
          }),
        );
      } finally {
        setIsSending(false);
        setIsAssistantTyping(false);
        lastOptimisticMessageIdRef.current = null;

        // Manual retry: do not force scroll here, Conversation controls scroll
        void isFromManualRetry;
      }
    },
    [
      isSending,
      createOptimisticMessage,
      setChatMessages,
      clearAllInput,
      setIsSending,
      setJustSentMessage,
      setCurrentThoughtText,
      lastOptimisticMessageIdRef,
      setIsAssistantTyping,
      showToast,
      onMessageSent,
      refreshLatestMessagesFromServer,
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
          const isPdf = file.type === 'application/pdf';

          return {
            file: newFile,
            previewUrl: att.url,
            type: isPdf ? 'document' : 'image',
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
