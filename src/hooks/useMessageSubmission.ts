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
  isSearchActive: boolean; // still passed from Conversation, unused here
  isSending: boolean;
  setIsSending: (isSending: boolean) => void;
  setJustSentMessage: (justSent: boolean) => void;
  setCurrentThoughtText: (text: string) => void;
  lastOptimisticMessageIdRef: MutableRefObject<string | null>;
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessageFromServer[]>>;
  setIsAssistantTyping: (isTyping: boolean) => void;
  clearAllInput: () => void;

  // IMPORTANT: keep this in props so Conversation can pass it (fixes your build error),
  // but we intentionally do NOT call it on stream completion / image reconciliation.
  scrollToBottom: (smooth?: boolean, force?: boolean) => void;

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
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
    });

  if (uploadError) {
    console.error('Supabase upload error', uploadError);
    throw uploadError;
  }

  const { data } = supabase.storage.from(ATTACHMENTS_BUCKET).getPublicUrl(path);
  const publicUrl = data?.publicUrl || '';

  if (!publicUrl) {
    throw new Error('Failed to obtain public URL from Supabase');
  }

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
  isSearchActive: _isSearchActive,
  isSending,
  setIsSending,
  setJustSentMessage,
  setCurrentThoughtText,
  lastOptimisticMessageIdRef,
  setChatMessages,
  setIsAssistantTyping,
  clearAllInput,
  scrollToBottom: _scrollToBottom, // intentionally unused
  onMessageSent,
}: UseMessageSubmissionProps) => {
  const { showToast } = useToast();

  const messageRelationshipMapRef = useRef<Map<string, string>>(new Map());
  const mostRecentAssistantMessageIdRef = useRef<string | null>(null);

  const createOptimisticUserMessage = useCallback(
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
        failed: false,
        finish_reason: null,
      };
    },
    [chatMessages],
  );

  const createOptimisticAssistantPlaceholder = useCallback(
    (assistantMessageId: string, tryNumber: number): ChatMessageFromServer => {
      return {
        message_id: assistantMessageId,
        content: '',
        content_type: 'assistant',
        timestamp: createLocalTimestamp(),
        attachments: [],
        try_number: tryNumber,
        failed: false,
        finish_reason: null,
      };
    },
    [],
  );

  const getMostRecentAssistantMessageId = useCallback(() => {
    return mostRecentAssistantMessageIdRef.current;
  }, []);

  // Reconcile server images/attachments WITHOUT nuking the local array
  // and WITHOUT triggering any scroll.
  const reconcileWithServer = useCallback(
    async (assistantPlaceholderId: string, fullAssistantText: string) => {
      try {
        const res = await chatService.getChatHistory(1);
        if (!res?.data || res.data.length === 0) return;

        const serverMessages = (res.data as ChatMessageFromServer[])
          .map((m) => ({ ...m, attachments: m.attachments ?? [] }))
          .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

        // Candidate: most recent assistant message on server
        const candidate = [...serverMessages]
          .reverse()
          .find((m) => m.content_type === 'assistant');

        if (!candidate) return;

        // If candidate has images/attachments or non-empty content, use it
        const candidateHasMedia =
          (candidate.attachments?.length ?? 0) > 0 ||
          ((candidate as unknown as { generatedImages?: unknown[] }).generatedImages?.length ??
            0) > 0;

        const candidateHasText = !!(candidate.content || '').trim();

        if (!candidateHasMedia && !candidateHasText) return;

        setChatMessages((prev) => {
          // Remove placeholder assistant message
          const withoutPlaceholder = prev.filter(
            (m) => m.message_id !== assistantPlaceholderId,
          );

          // Also: if placeholder was the only assistant text, keep its text by copying into candidate if candidate is empty
          const patchedCandidate: ChatMessageFromServer =
            !candidateHasText && fullAssistantText.trim()
              ? { ...candidate, content: fullAssistantText }
              : candidate;

          const alreadyExists = withoutPlaceholder.some(
            (m) => m.message_id === patchedCandidate.message_id,
          );

          const merged = withoutPlaceholder.map((m) =>
            m.message_id === patchedCandidate.message_id
              ? {
                  ...m,
                  ...patchedCandidate,
                  attachments: patchedCandidate.attachments ?? m.attachments ?? [],
                }
              : m,
          );

          const withInsert = alreadyExists ? merged : [...merged, patchedCandidate];

          return withInsert.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
        });
      } catch (err) {
        console.error('Failed to reconcile latest server messages:', err);
      }
    },
    [setChatMessages],
  );

  const executeSubmission = useCallback(
    async (
      messageText: string,
      attachments: ChatAttachmentInputState[] = [],
      tryNumber: number = 1,
      optimisticUserIdToUpdate?: string,
      isFromManualRetry: boolean = false,
    ) => {
      if (isSending) return;

      const trimmedMessage = messageText.trim();
      const hasText = trimmedMessage.length > 0;
      const hasAttachments = attachments.length > 0;

      if (!hasText && !hasAttachments) return;

      // STEP 1: upload attachments
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

      const attachmentsWithStorage: ChatAttachmentInputState[] = attachments.map(
        (att, index) => {
          const meta = uploaded[index];
          if (!meta) return att;
          return { ...att, storagePath: meta.storagePath, publicUrl: meta.publicUrl };
        },
      );

      const optimisticUserId = optimisticUserIdToUpdate || `optimistic-${Date.now()}`;
      const assistantPlaceholderId = `assistant-${Date.now()}`;

      // STEP 2: update UI (append user + assistant placeholder)
      if (!optimisticUserIdToUpdate) {
        const userMessage = createOptimisticUserMessage(
          optimisticUserId,
          trimmedMessage,
          attachmentsWithStorage,
        );
        const assistantPlaceholder = createOptimisticAssistantPlaceholder(
          assistantPlaceholderId,
          tryNumber,
        );

        messageRelationshipMapRef.current.set(optimisticUserId, assistantPlaceholderId);
        mostRecentAssistantMessageIdRef.current = assistantPlaceholderId;

        setChatMessages((prev) => [...prev, userMessage, assistantPlaceholder]);

        clearAllInput();
        onMessageSent?.();

        // IMPORTANT: we do NOT force scroll here.
        // Conversation/index.tsx already scrolls once on send (controlled).
      } else {
        // Retry: mark user message not failed, and append a new assistant placeholder at end
        messageRelationshipMapRef.current.set(optimisticUserId, assistantPlaceholderId);
        mostRecentAssistantMessageIdRef.current = assistantPlaceholderId;

        setChatMessages((prev) => {
          const cleared = prev.map((m) =>
            m.message_id === optimisticUserId
              ? { ...m, failed: false, try_number: tryNumber }
              : m,
          );
          return [...cleared, createOptimisticAssistantPlaceholder(assistantPlaceholderId, tryNumber)];
        });
      }

      setIsSending(true);
      setJustSentMessage(true);
      setCurrentThoughtText('');
      lastOptimisticMessageIdRef.current = optimisticUserId;
      setIsAssistantTyping(true);

      // STEP 3: payload
      let payloadMessage = trimmedMessage;

      if (uploaded.length > 0) {
        const attachmentsTextLines = uploaded.map(
          (meta) =>
            `- ${meta.name} (${meta.mimeType}, ${meta.size} bytes): ${meta.publicUrl}`,
        );

        payloadMessage = [
          trimmedMessage,
          '',
          'Attached files (public URLs, please open and read them):',
          ...attachmentsTextLines,
        ]
          .filter(Boolean)
          .join('\n');
      }

      const assistantId =
        messageRelationshipMapRef.current.get(optimisticUserId) || assistantPlaceholderId;

      try {
        let fullAssistantText = '';

        await chatService.streamMessage({
          message: payloadMessage,
          onDelta: (delta) => {
            fullAssistantText += delta;

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

            // IMPORTANT: reconcile media WITHOUT replacing the entire chat array,
            // and WITHOUT any forced scrolling.
            await reconcileWithServer(assistantId, fullAssistantText);
          },
          onError: (err) => {
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
          prev.map((m) => {
            if (m.message_id === optimisticUserId) return { ...m, failed: true };
            if (m.message_id === assistantId) {
              return { ...m, failed: true, failedMessage: 'Failed to respond, try again' };
            }
            return m;
          }),
        );
      } finally {
        setIsSending(false);
        setIsAssistantTyping(false);
        lastOptimisticMessageIdRef.current = null;

        // IMPORTANT: no scroll here (even on retry completion).
        // The only scroll should be the single send-triggered scroll in Conversation.
        void isFromManualRetry;
      }
    },
    [
      isSending,
      showToast,
      setChatMessages,
      clearAllInput,
      setIsSending,
      setJustSentMessage,
      setCurrentThoughtText,
      lastOptimisticMessageIdRef,
      setIsAssistantTyping,
      onMessageSent,
      createOptimisticUserMessage,
      createOptimisticAssistantPlaceholder,
      reconcileWithServer,
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

  const clearMessageRelationshipMap = useCallback(() => {
    messageRelationshipMapRef.current.clear();
    mostRecentAssistantMessageIdRef.current = null;
  }, []);

  return {
    handleSubmit,
    executeSubmission,
    handleRetryMessage,
    getMostRecentAssistantMessageId,
    clearMessageRelationshipMap,
  };
};
