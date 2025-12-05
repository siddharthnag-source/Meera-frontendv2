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
  isSearchActive: boolean; // still passed from Conversation, but we don't need it here
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

// ---------- IMAGE TRIGGERS (client-side) ----------

const IMAGE_TRIGGERS = ['image', 'photo', 'picture', 'img', 'pic'];

function isImageRequest(text: string | null | undefined): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return IMAGE_TRIGGERS.some((t) =>
    new RegExp('\\b' + t + '\\b', 'i').test(lower),
  );
}

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

      // STEP 1: upload all attachments to Supabase Storage
      let uploaded: UploadedMeta[] = [];
      if (hasAttachments) {
        try {
          uploaded = await Promise.all(
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

      // Attach storagePath/publicUrl back onto attachments for optimistic UI
      const attachmentsWithStorage: ChatAttachmentInputState[] =
        attachments.map((att, index) => {
          const meta = uploaded[index];
          if (!meta) return att;
          return {
            ...att,
            storagePath: meta.storagePath,
            publicUrl: meta.publicUrl,
          };
        });

      const optimisticId = optimisticIdToUpdate || `optimistic-${Date.now()}`;

      // STEP 2: create optimistic user + assistant placeholders
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

      // STEP 3: build a payload message that includes public URLs
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
        messageRelationshipMapRef.current.get(optimisticId);

      const wantsImage = isImageRequest(trimmedMessage);

      try {
        // ---------- IMAGE MODE (non-streaming, JSON) ----------
        if (wantsImage) {
          const { data: imgResult, error: funcError } =
            await supabase.functions.invoke('chat', {
              body: {
                message: payloadMessage,
                stream: false, // important: non-stream for images
              },
            });

          if (funcError || !imgResult) {
            console.error('Supabase function error (image):', funcError);
            throw funcError || new Error('No data returned from image function');
          }

          const rawImages: GeneratedImage[] = Array.isArray(imgResult.images)
            ? imgResult.images
            : [];

          const imagesWithDataUrl: GeneratedImage[] = rawImages.map((img) => ({
            mimeType: img.mimeType || 'image/png',
            data: img.data,
            dataUrl:
              img.dataUrl ||
              (img.data
                ? `data:${img.mimeType || 'image/png'};base64,${img.data}`
                : undefined),
          }));

          const imageAttachments: ChatAttachmentFromServer[] =
            imagesWithDataUrl.map((img, index) => ({
              name: `generated-image-${Date.now()}-${index}.png`,
              type: img.mimeType || 'image/png',
              url: img.dataUrl || '',
            }));

          const assistantContent =
            imgResult.reply || 'Here is an image for you.';

          if (assistantId) {
            setChatMessages((prev) =>
              prev.map((msg) =>
                msg.message_id === assistantId
                  ? {
                      ...msg,
                      content: assistantContent,
                      attachments: imageAttachments,
                      failed: false,
                      try_number: tryNumber,
                      isGeneratingImage: false,
                      generatedImages: imagesWithDataUrl,
                    }
                  : msg,
              ),
            );
          } else {
            // Fallback: no placeholder found, append a new assistant message
            const fallbackAssistant: ChatMessageFromServer = {
              message_id: `assistant-${Date.now()}`,
              content: assistantContent,
              content_type: 'assistant',
              timestamp: createLocalTimestamp(),
              attachments: imageAttachments,
              try_number: tryNumber,
              failed: false,
              isGeneratingImage: false,
              generatedImages: imagesWithDataUrl,
            };
            setChatMessages((prev) => [...prev, fallbackAssistant]);
          }

          return;
        }

        // ---------- TEXT MODE (streaming) ----------
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
