'use client';

import { ApiError, chatService, SessionExpiredError } from '@/app/api/services/chat';
import { useToast } from '@/components/ui/ToastProvider';
import { createLocalTimestamp } from '@/lib/dateUtils';
import { getSystemInfo } from '@/lib/deviceInfo';
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
  scrollToBottom: (smooth?: boolean) => void;
  onMessageSent?: () => void;
}

// Streaming event shapes we might receive
type StreamEvent =
  | { delta?: string; response?: string; done?: boolean; finish_reason?: string | null; thoughts?: string; thoughtText?: string }
  | string;

type DbInsertRow = {
  message_id: string;
  content_type: 'user' | 'assistant';
  content: string;
  timestamp: string;
};

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

  // Helper: update assistant bubble content incrementally
  const appendToAssistant = useCallback(
    (assistantId: string, nextText: string, tryNumber: number) => {
      setChatMessages((prev) =>
        prev.map((m) =>
          m.message_id === assistantId
            ? {
                ...m,
                content: nextText,
                timestamp: createLocalTimestamp(),
                failed: false,
                try_number: tryNumber,
              }
            : m,
        ),
      );
    },
    [setChatMessages],
  );

  // Helper: persist to DB and swap optimistic ids to real ids
  const persistAndSwapIds = useCallback(
    async (optimisticUserId: string, optimisticAssistantId: string, userText: string, assistantText: string) => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const userId = session?.user?.id;
        if (!userId) return;

        const nowIso = new Date().toISOString();

        const { data: inserted, error } = await supabase
          .from('messages')
          .insert([
            {
              user_id: userId,
              content_type: 'user',
              content: userText,
              timestamp: nowIso,
              is_call: false,
            },
            {
              user_id: userId,
              content_type: 'assistant',
              content: assistantText,
              timestamp: nowIso,
              is_call: false,
            },
          ])
          .select('message_id, content_type, content, timestamp');

        if (error || !inserted) {
          console.error('persistAndSwapIds: insert error', error);
          return;
        }

        const rows = inserted as DbInsertRow[];
        const dbUser = rows.find((r) => r.content_type === 'user');
        const dbAssistant = rows.find((r) => r.content_type === 'assistant');

        if (!dbUser || !dbAssistant) return;

        // Swap ids in UI so history de-dupe works
        setChatMessages((prev) =>
          prev.map((m) => {
            if (m.message_id === optimisticUserId) {
              return { ...m, message_id: dbUser.message_id, timestamp: dbUser.timestamp };
            }
            if (m.message_id === optimisticAssistantId) {
              return { ...m, message_id: dbAssistant.message_id, timestamp: dbAssistant.timestamp };
            }
            return m;
          }),
        );

        // Update relationship map and most recent assistant id
        messageRelationshipMapRef.current.delete(optimisticUserId);
        messageRelationshipMapRef.current.set(dbUser.message_id, dbAssistant.message_id);
        mostRecentAssistantMessageIdRef.current = dbAssistant.message_id;
      } catch (e) {
        console.error('persistAndSwapIds: unexpected', e);
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
      if (!trimmedMessage && attachments.length === 0) return;

      const optimisticUserId = optimisticIdToUpdate || `optimistic-${Date.now()}`;

      let optimisticAssistantId = messageRelationshipMapRef.current.get(optimisticUserId) || '';

      // If not a retry, create user + empty assistant messages
      if (!optimisticIdToUpdate) {
        const userMessage = createOptimisticMessage(optimisticUserId, trimmedMessage, attachments);

        optimisticAssistantId = `assistant-${Date.now()}`;
        const emptyAssistantMessage: ChatMessageFromServer = {
          message_id: optimisticAssistantId,
          content: '',
          content_type: 'assistant',
          timestamp: createLocalTimestamp(),
          attachments: [],
          try_number: tryNumber,
          failed: false,
        };

        messageRelationshipMapRef.current.set(optimisticUserId, optimisticAssistantId);
        mostRecentAssistantMessageIdRef.current = optimisticAssistantId;

        setChatMessages((prev) => [...prev, userMessage, emptyAssistantMessage]);

        clearAllInput();
        onMessageSent?.();
        setTimeout(() => scrollToBottom(true), 300);
      } else {
        // Retry: clear failed state
        setChatMessages((prev) =>
          prev.map((msg) =>
            msg.message_id === optimisticUserId ? { ...msg, failed: false, try_number: tryNumber } : msg,
          ),
        );
      }

      setIsSending(true);
      setJustSentMessage(true);
      setCurrentThoughtText('');
      lastOptimisticMessageIdRef.current = optimisticUserId;
      setIsAssistantTyping(true);

      const formData = new FormData();
      if (trimmedMessage) formData.append('message', trimmedMessage);
      attachments.forEach((att) => formData.append('files', att.file, att.file.name));
      if (isSearchActive) formData.append('google_search', 'true');

      const systemInfo = await getSystemInfo();
      if (systemInfo.device) formData.append('device', systemInfo.device);
      if (systemInfo.location) formData.append('location', systemInfo.location);
      if (systemInfo.network) formData.append('network', systemInfo.network);

      let finalAssistantText = '';

      try {
        const response = await chatService.sendMessage(formData);

        const contentType = response.headers.get('content-type') || '';
        const isSSE = contentType.includes('text/event-stream');

        if (!response.body) {
          throw new Error('No response body for streaming');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');

        let buffer = '';
        let done = false;

        while (!done) {
          const { value, done: readDone } = await reader.read();
          done = readDone;

          if (value) {
            const chunk = decoder.decode(value, { stream: true });

            if (isSSE) {
              buffer += chunk;
              const events = buffer.split('\n\n');
              buffer = events.pop() || '';

              for (const evt of events) {
                const lines = evt.split('\n');
                for (const line of lines) {
                  const trimmed = line.trim();
                  if (!trimmed.startsWith('data:')) continue;

                  const dataStr = trimmed.replace(/^data:\s*/, '');

                  if (dataStr === '[DONE]') {
                    done = true;
                    break;
                  }

                  let parsed: StreamEvent = dataStr;

                  try {
                    parsed = JSON.parse(dataStr) as StreamEvent;
                  } catch {
                    // treat as plain text delta
                  }

                  if (typeof parsed === 'string') {
                    finalAssistantText += parsed;
                    if (optimisticAssistantId) {
                      appendToAssistant(optimisticAssistantId, finalAssistantText, tryNumber);
                    }
                    continue;
                  }

                  const thoughts = parsed.thoughts ?? parsed.thoughtText ?? '';
                  if (thoughts) {
                    setCurrentThoughtText(thoughts);
                  }

                  if (parsed.delta) {
                    finalAssistantText += parsed.delta;
                    if (optimisticAssistantId) {
                      appendToAssistant(optimisticAssistantId, finalAssistantText, tryNumber);
                    }
                  } else if (parsed.response) {
                    finalAssistantText = parsed.response;
                    if (optimisticAssistantId) {
                      appendToAssistant(optimisticAssistantId, finalAssistantText, tryNumber);
                    }
                  }

                  if (parsed.done || parsed.finish_reason != null) {
                    done = true;
                    break;
                  }
                }
                if (done) break;
              }
            } else {
              // raw text streaming
              finalAssistantText += chunk;
              if (optimisticAssistantId) {
                appendToAssistant(optimisticAssistantId, finalAssistantText, tryNumber);
              }
            }
          }
        }

        // Persist to DB and swap optimistic ids to real ids
        if (optimisticAssistantId) {
          await persistAndSwapIds(
            optimisticUserId,
            optimisticAssistantId,
            trimmedMessage,
            finalAssistantText || '',
          );
        }
      } catch (error) {
        console.error('Error sending message:', error);

        if (error instanceof SessionExpiredError) {
          setChatMessages((prev) =>
            prev.map((msg) =>
              msg.message_id === optimisticUserId ? { ...msg, failed: true } : msg,
            ),
          );
        } else if (error instanceof ApiError && error.status === 400) {
          showToast('Unsupported file', { type: 'error', position: 'conversation' });
          setChatMessages((prev) =>
            prev.map((msg) =>
              msg.message_id === optimisticUserId ? { ...msg, failed: true } : msg,
            ),
          );
        } else {
          showToast('Failed to respond, try again', { type: 'error', position: 'conversation' });

          const assistantId = messageRelationshipMapRef.current.get(optimisticUserId);

          setChatMessages((prev) =>
            prev.map((msg) => {
              if (msg.message_id === optimisticUserId) {
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
      appendToAssistant,
      persistAndSwapIds,
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
