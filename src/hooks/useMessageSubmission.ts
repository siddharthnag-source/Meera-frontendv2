'use client';

import { chatService } from '@/app/api/services/chat';
import { useToast } from '@/components/ui/ToastProvider';
import { createLocalTimestamp } from '@/lib/dateUtils';
import { supabase } from '@/lib/supabaseClient';
import {
  ChatAttachmentInputState,
  ChatMessageFromServer,
  ChatAttachmentFromServer,
  GeneratedImage,
} from '@/types/chat';
import React, {
  MutableRefObject,
  useCallback,
  useRef,
} from 'react';

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

/**
 * Upload a file to Supabase Storage and return metadata (including public URL).
 */
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

  const { data } = supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .getPublicUrl(path);

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

/**
 * Convert a base64 string into a File so we can upload it to Storage.
 */
function base64ToFile(base64Data: string, fileName: string, mimeType: string): File {
  const byteString = atob(base64Data);
  const len = byteString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = byteString.charCodeAt(i);
  }
  return new File([bytes], fileName, { type: mimeType });
}

export const useMessageSubmission = ({
  message,
  currentAttachments,
  chatMessages,
  // isSearchActive, // not needed inside this hook right now
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

      // STEP 1: upload user attachments (if any) to Storage
      let uploadedUserAttachments: UploadedMeta[] = [];
      if (hasAttachments) {
        try {
          uploadedUserAttachments = await Promise.all(
            attachments.map((att) =>
              uploadAttachmentToStorage(att.file, att.type),
            ),
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

      // enrich attachment state with storage info for optimistic UI
      const attachmentsWithStorage: ChatAttachmentInputState[] =
        attachments.map((att, index) => {
          const meta = uploadedUserAttachments[index];
          if (!meta) return att;
          return {
            ...att,
            storagePath: meta.storagePath,
            publicUrl: meta.publicUrl,
          };
        });

      const optimisticId = optimisticIdToUpdate || `optimistic-${Date.now()}`;

      // STEP 2: optimistic user + assistant placeholder messages
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
          isGeneratingImage: false,
        };

        messageRelationshipMapRef.current.set(optimisticId, assistantMessageId);
        mostRecentAssistantMessageIdRef.current = assistantMessageId;

        setChatMessages((prev) => [...prev, userMessage, emptyAssistantMessage]);

        clearAllInput();
        onMessageSent?.();

        setTimeout(() => scrollToBottom(true, true), 150);
      } else {
        // Retry: clear failed state for the user message
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

      // STEP 3: build payload text (includes public URLs for user attachments)
      let payloadMessage = trimmedMessage;

      if (uploadedUserAttachments.length > 0) {
        const attachmentsTextLines = uploadedUserAttachments.map(
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
        messageRelationshipMapRef.current.get(optimisticId);

      try {
        let fullAssistantText = '';

        await chatService.streamMessage({
          message: payloadMessage,
          onDelta: (delta: string) => {
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
          onError: (err: unknown) => {
            throw err;
          },

          /**
           * NEW: when Gemini returns images (for "generate image of ..." prompts),
           * upload them to Supabase Storage and persist as message attachments.
           */
          onImages: async (images: GeneratedImage[]) => {
            if (!assistantId || !images || images.length === 0) return;

            try {
              // 1) Convert base64 → File
              const files: File[] = images.map((img, index) => {
                const mimeType = img.mimeType || 'image/png';
                const base64 =
                  img.data ||
                  (img.dataUrl ? img.dataUrl.split(',')[1] || '' : '');
                const ext = mimeType.split('/')[1] || 'png';
                const fileName = `generated-${Date.now()}-${index}.${ext}`;
                return base64ToFile(base64, fileName, mimeType);
              });

              // 2) Upload each file to Storage
              const uploadedGenerated = await Promise.all(
                files.map((file) => uploadAttachmentToStorage(file, 'image')),
              );

              // 3) Build attachment objects with public URLs
              const imageAttachments: ChatAttachmentFromServer[] =
                uploadedGenerated.map((meta) => ({
                  name: meta.name,
                  type: 'image',
                  url: meta.publicUrl,
                  size: meta.size,
                }));

              // 4) Update in-memory assistant message so the image shows immediately
              setChatMessages((prev) =>
                prev.map((msg) =>
                  msg.message_id === assistantId
                    ? {
                        ...msg,
                        attachments: imageAttachments,
                        isGeneratingImage: false,
                      }
                    : msg,
                ),
              );

              // 5) Persist attachments into the messages table (so they survive refresh)
              try {
                await supabase
                  .from('messages')
                  .update({ attachments: imageAttachments })
                  .eq('message_id', assistantId);
              } catch (dbErr) {
                console.error(
                  'Failed to persist generated image attachments to messages table',
                  dbErr,
                );
              }
            } catch (uploadErr) {
              console.error('Error handling generated images', uploadErr);
            }
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

      const retryAttachments: ChatAttachmentInputState[] =
        messageAttachments
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
