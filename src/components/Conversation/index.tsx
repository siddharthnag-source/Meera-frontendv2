'use client';

import { chatService } from '@/app/api/services/chat';
import { MeeraVoice } from '@/components/MeeraVoice';
import { Toast } from '@/components/ui/Toast';
import { useToast } from '@/components/ui/ToastProvider';
import { UserProfile } from '@/components/ui/UserProfile';
import { usePricingModal } from '@/contexts/PricingModalContext';
import { useDragAndDrop } from '@/hooks/useDragAndDrop';
import { useMessageSubmission } from '@/hooks/useMessageSubmission';
import { useSubscriptionStatus } from '@/hooks/useSubscriptionStatus';
import { formatWhatsAppStyle } from '@/lib/dateUtils';
import { getSystemInfo } from '@/lib/deviceInfo';
import { supabase } from '@/lib/supabaseClient';
import { debounce, throttle } from '@/lib/utils';
import { ChatAttachmentInputState, ChatMessageFromServer } from '@/types/chat';
import { useSession } from 'next-auth/react';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FiArrowUp, FiGlobe, FiMenu } from 'react-icons/fi';
import { IoCallSharp } from 'react-icons/io5';
import { MdKeyboardArrowDown } from 'react-icons/md';
import { AttachmentInputArea, AttachmentInputAreaRef } from './AttachmentInputArea';
import { AttachmentPreview } from './AttachmentPreview';
import { CallSessionItem } from './CallSessionItem';
import { RenderedMessageItem } from './RenderedMessageItem';

const MAX_ATTACHMENTS_CONFIG = 10;
const DYNAMIC_MAX_HEIGHT_RATIO = 3.5;
const SCROLL_THRESHOLD = 150;
const FETCH_DEBOUNCE_MS = 300;
const SCROLL_THROTTLE_MS = 16; // 60fps
const INPUT_DEBOUNCE_MS = 16;
const RESIZE_DEBOUNCE_MS = 100;

type ChatDisplayItem =
  | { type: 'message'; message: ChatMessageFromServer; id: string }
  | {
      type: 'call_session';
      messages: ChatMessageFromServer[];
      session_id: string;
      timestamp: string;
      id: string;
    };

interface FetchState {
  isLoading: boolean;
  currentPage: number;
  hasMore: boolean;
  error: string | null;
  abortController: AbortController | null;
}

type LegacyMessageRow = {
  message_id: string;
  user_id: string;
  content_type: 'user' | 'assistant';
  content: string;
  timestamp: string;
  session_id: string | null;
  is_call: boolean | null;
};

// Memoized components for better performance
const MemoizedRenderedMessageItem = React.memo(RenderedMessageItem, (prevProps, nextProps) => {
  return (
    prevProps.message.message_id === nextProps.message.message_id &&
    prevProps.message.content === nextProps.message.content &&
    prevProps.isStreaming === nextProps.isStreaming &&
    prevProps.isLastFailedMessage === nextProps.isLastFailedMessage &&
    prevProps.message.failed === nextProps.message.failed &&
    prevProps.showTypingIndicator === nextProps.showTypingIndicator &&
    prevProps.thoughtText === nextProps.thoughtText &&
    prevProps.hasMinHeight === nextProps.hasMinHeight &&
    prevProps.dynamicMinHeight === nextProps.dynamicMinHeight
  );
});

const MemoizedCallSessionItem = React.memo(CallSessionItem, (prevProps, nextProps) => {
  return (
    prevProps.messages.length === nextProps.messages.length &&
    prevProps.messages.every((msg, index) => msg.message_id === nextProps.messages[index]?.message_id)
  );
});

const MemoizedAttachmentPreview = React.memo(AttachmentPreview, (prevProps, nextProps) => {
  return (
    prevProps.attachment.file?.name === nextProps.attachment.file?.name &&
    prevProps.attachment.previewUrl === nextProps.attachment.previewUrl &&
    prevProps.index === nextProps.index
  );
});

export const Conversation: React.FC = () => {
  // Core state
  const [message, setMessage] = useState('');
  const [inputValue, setInputValue] = useState(''); // Separate input state for debouncing
  const [currentAttachments, setCurrentAttachments] = useState<ChatAttachmentInputState[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessageFromServer[]>([]);
  const [isSearchActive, setIsSearchActive] = useState(true);
  const [currentThoughtText, setCurrentThoughtText] = useState('');
  const [dynamicMinHeight, setDynamicMinHeight] = useState<number>(500);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  // UI state
  const [showUserProfile, setShowUserProfile] = useState(false);
  const [showMeeraVoice, setShowMeeraVoice] = useState(false);

  // Legacy Meera mapping state
  const [legacyUserId, setLegacyUserId] = useState<string | null>(null);
  const [hasLoadedLegacyHistory, setHasLoadedLegacyHistory] = useState(false);

  // Loading states
  const [isSending, setIsSending] = useState(false);
  const [isAssistantTyping, setIsAssistantTyping] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isUserNearTop, setIsUserNearTop] = useState(false);

  // Fetch state management
  const [fetchState, setFetchState] = useState<FetchState>({
    isLoading: false,
    currentPage: 0,
    hasMore: true,
    error: null,
    abortController: null,
  });

  // Dynamic height
  const [dynamicMaxHeight, setDynamicMaxHeight] = useState(200);

  // Refs
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const attachmentInputAreaRef = useRef<AttachmentInputAreaRef>(null);
  const lastOptimisticMessageIdRef = useRef<string | null>(null);
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const initialLoadDone = useRef(false);
  const justSentMessageRef = useRef(false);
  const spacerRef = useRef<HTMLDivElement>(null);

  // New refs for height calculation
  const headerRef = useRef<HTMLElement>(null);
  const footerRef = useRef<HTMLElement>(null);
  const latestUserMessageRef = useRef<HTMLDivElement | null>(null);
  const latestAssistantMessageRef = useRef<HTMLDivElement | null>(null);

  const requestCache = useRef<Map<string, Promise<unknown>>>(new Map());
  const cleanupFunctions = useRef<Array<() => void>>([]);
  const chatMessagesRef = useRef<ChatMessageFromServer[]>(chatMessages);

  // Scroll handling refs
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastScrollTop = useRef(0);
  const isScrollingUp = useRef(false);
  const previousScrollHeight = useRef(0);

  // Scroll direction detection
  const lastScrollTopRef = useRef(0);
  const scrollTimeoutRef2 = useRef<NodeJS.Timeout | null>(null);

  // Hooks
  const { data: sessionData, status: sessionStatus } = useSession();
  const {
    data: subscriptionData,
    isLoading: isSubscriptionLoading,
    isError: isSubscriptionError,
  } = useSubscriptionStatus();
  const { showToast } = useToast();
  const { openModal } = usePricingModal();

  // Update chatMessagesRef when chatMessages changes
  useEffect(() => {
    chatMessagesRef.current = chatMessages;
  }, [chatMessages]);

  // Debounced input handling
  const debouncedSetMessage = useMemo(
    () => debounce((value: string) => setMessage(value), INPUT_DEBOUNCE_MS),
    [],
  );

  useEffect(() => {
    debouncedSetMessage(inputValue);
  }, [inputValue, debouncedSetMessage]);

  const lastFailedMessageId = useMemo(() => {
    for (let i = chatMessages.length - 1; i >= 0; i--) {
      const msg = chatMessages[i];
      if (msg.content_type === 'user' && msg.failed) {
        return msg.message_id;
      }
    }
    return null;
  }, [chatMessages]);

  // Simple height calculation function
  const calculateMinHeight = useCallback(() => {
    const viewportHeight = window.innerHeight;

    const headerHeight = headerRef.current?.offsetHeight || 80;
    const footerHeight = (footerRef.current?.offsetHeight || 0) - 45;
    const userMessageHeight = latestUserMessageRef.current?.offsetHeight || 0;

    const calculatedMinHeight = Math.max(
      0,
      viewportHeight - headerHeight - footerHeight - userMessageHeight - 100,
    );

    setDynamicMinHeight(calculatedMinHeight);
  }, []);

  // Optimized message processing
  const processMessagesForDisplay = useCallback(
    (messages: ChatMessageFromServer[]): [string, ChatDisplayItem[]][] => {
      const grouped: Record<string, ChatDisplayItem[]> = {};

      const groupCallSessions = (msgs: ChatMessageFromServer[]): ChatDisplayItem[] => {
        const displayItems: ChatDisplayItem[] = [];
        const callSessions: Record<string, ChatMessageFromServer[]> = {};

        msgs.forEach((msg) => {
          if (msg.is_call && msg.session_id) {
            if (!callSessions[msg.session_id]) {
              callSessions[msg.session_id] = [];
            }
            callSessions[msg.session_id].push(msg);
          } else {
            displayItems.push({ type: 'message', message: msg, id: msg.message_id });
          }
        });

        for (const sessionId in callSessions) {
          const sessionMessages = callSessions[sessionId].sort((a, b) =>
            a.timestamp.localeCompare(b.timestamp),
          );
          if (sessionMessages.length > 0) {
            displayItems.push({
              type: 'call_session',
              messages: sessionMessages,
              session_id: sessionId,
              timestamp: sessionMessages[sessionMessages.length - 1].timestamp,
              id: sessionId,
            });
          }
        }

        return displayItems.sort((a, b) => {
          const timestampA = a.type === 'message' ? a.message.timestamp : a.timestamp;
          const timestampB = b.type === 'message' ? b.message.timestamp : b.timestamp;
          return timestampA.localeCompare(timestampB);
        });
      };

      const displayItems = groupCallSessions(messages);

      displayItems.forEach((item) => {
        const timestamp = item.type === 'message' ? item.message.timestamp : item.timestamp;
        const tsMatch = timestamp.match(/^(\d{4})-(\d{2})-(\d{2})/);
        const dateKey = tsMatch ? tsMatch[0] : 'unknown';

        if (!grouped[dateKey]) {
          grouped[dateKey] = [];
        }
        grouped[dateKey].push(item);
      });

      return Object.entries(grouped).sort(([dateKeyA], [dateKeyB]) => {
        if (dateKeyA === 'unknown') return 1;
        if (dateKeyB === 'unknown') return -1;
        return dateKeyA.localeCompare(dateKeyB);
      });
    },
    [],
  );

  const messagesByDate = useMemo(
    () => processMessagesForDisplay(chatMessages),
    [chatMessages, processMessagesForDisplay],
  );

  const lastMessage = chatMessages.length > 0 ? chatMessages[chatMessages.length - 1] : null;

  const canSubmit = useMemo(
    () => (message.trim() || currentAttachments.length > 0) && !isSending,
    [message, currentAttachments.length, isSending],
  );

  // Optimized scroll to bottom with RAF
  const scrollToBottom = useCallback((smooth: boolean = true) => {
    if (mainScrollRef.current) {
      requestAnimationFrame(() => {
        if (mainScrollRef.current) {
          mainScrollRef.current.scrollTo({
            top: mainScrollRef.current.scrollHeight,
            behavior: smooth ? 'smooth' : 'instant',
          });
        }
      });
    }
  }, []);

  /**
   * LEGACY MEERA REVIVE
   * 1. Map Google login email -> legacy users.id
   * 2. If found, load messages from legacy `messages` table and map to ChatMessageFromServer
   */

  // Step 1: find legacy user id by email
  useEffect(() => {
    const email = sessionData?.user?.email;
    if (!email) return;

    const findLegacyUser = async () => {
      try {
        const { data, error } = await supabase
          .from('users')
          .select('id')
          .eq('email', email)
          .limit(1)
          .maybeSingle();

        if (error) {
          console.error('Error fetching legacy user', error);
          return;
        }

        if (data?.id) {
          setLegacyUserId(data.id as string);
        }
      } catch (err) {
        console.error('Error fetching legacy user', err);
      }
    };

    findLegacyUser();
  }, [sessionData?.user?.email]);

  // Step 2: load legacy messages for that user_id
  useEffect(() => {
    if (!legacyUserId || hasLoadedLegacyHistory) return;

    const loadLegacyHistory = async () => {
      try {
        setIsInitialLoading(true);

        const { data, error } = await supabase
          .from('messages')
          .select('message_id,user_id,content_type,content,timestamp,session_id,is_call')
          .eq('user_id', legacyUserId)
          .order('timestamp', { ascending: true });

        if (error) {
          console.error('Error loading legacy messages', error);
          setIsInitialLoading(false);
          return;
        }

        if (!data || data.length === 0) {
          setHasLoadedLegacyHistory(true);
          setIsInitialLoading(false);
          return;
        }

        const mapped: ChatMessageFromServer[] = (data as LegacyMessageRow[]).map((row) => ({
          message_id: row.message_id,
          user_id: row.user_id,
          content_type: row.content_type,
          content: row.content,
          timestamp: row.timestamp,
          session_id: row.session_id ?? undefined,
          is_call: row.is_call ?? false,
          attachments: [],
          failed: false,
          finish_reason: null,
        }));

        setChatMessages(mapped);
        setHasLoadedLegacyHistory(true);

        requestAnimationFrame(() => {
          setTimeout(() => scrollToBottom(false), 50);
        });
      } catch (err) {
        console.error('Error loading legacy messages', err);
      } finally {
        setIsInitialLoading(false);
      }
    };

    loadLegacyHistory();
  }, [legacyUserId, hasLoadedLegacyHistory, scrollToBottom]);

  // Optimized chat history loading with proper cleanup and caching (new backend)
  const loadChatHistory = useCallback(
    async (page: number = 1, isInitial: boolean = false, retryCount = 0) => {
      const cacheKey = `${page}-${isInitial}`;

      if (requestCache.current.has(cacheKey)) {
        return requestCache.current.get(cacheKey);
      }

      if (fetchState.isLoading && !isInitial) return;

      if (fetchState.abortController && !isInitial) {
        fetchState.abortController.abort();
      }

      const abortController = new AbortController();

      const loadPromise = (async () => {
        setFetchState((prev) => ({
          ...prev,
          isLoading: true,
          error: null,
          abortController,
          currentPage: page,
        }));

        if (isInitial) {
          setIsInitialLoading(true);
        }

        try {
          const response = await chatService.getChatHistory(page);

          if (abortController.signal.aborted) return;

          if (response.data && response.data.length > 0) {
            const messages = response.data
              .map((msg: ChatMessageFromServer) => ({ ...msg, attachments: msg.attachments || [] }))
              .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

            if (isInitial && !hasLoadedLegacyHistory) {
              setChatMessages(messages);
              requestAnimationFrame(() => {
                setTimeout(() => scrollToBottom(false), 50);
              });
            } else if (!isInitial) {
              const scrollContainer = mainScrollRef.current;
              if (scrollContainer) {
                previousScrollHeight.current = scrollContainer.scrollHeight;
              }

              setChatMessages((prev) => {
                const existingIds = new Set(prev.map((msg) => msg.message_id));
                const newMessages = messages.filter((msg) => !existingIds.has(msg.message_id));
                return [...newMessages, ...prev];
              });
            }

            const hasMoreMessages = response.data.length >= 20;

            setFetchState((prev) => ({
              ...prev,
              isLoading: false,
              hasMore: hasMoreMessages,
              error: null,
              abortController: null,
            }));
          } else {
            setFetchState((prev) => ({
              ...prev,
              isLoading: false,
              hasMore: false,
              error: isInitial ? 'No messages found.' : null,
              abortController: null,
            }));

            if (isInitial && !hasLoadedLegacyHistory) {
              setChatMessages([]);
            }
          }
        } catch (error: unknown) {
          if (error instanceof Error && error.name === 'AbortError') return;

          console.error('Error fetching chat history:', error);

          if (
            retryCount < 2 &&
            ((error instanceof Error &&
              'code' in error &&
              (error as { code?: string }).code === 'NETWORK_ERROR') ||
              !navigator.onLine)
          ) {
            setTimeout(() => {
              loadChatHistory(page, isInitial, retryCount + 1);
            }, 1000 * (retryCount + 1));
            return;
          }

          const errorMessage = isInitial
            ? 'Failed to load messages. Please check your connection and try again.'
            : 'Failed to load older messages.';

          setFetchState((prev) => ({
            ...prev,
            isLoading: false,
            error: errorMessage,
            abortController: null,
          }));

          if (isInitial && !hasLoadedLegacyHistory) {
            setChatMessages([]);
          } else if (!isInitial) {
            showToast('Failed to load older messages. Please try again.', {
              type: 'error',
              position: 'conversation',
            });
          }
        } finally {
          if (isInitial) {
            setIsInitialLoading(false);
          }
        }
      })();

      requestCache.current.set(cacheKey, loadPromise);

      loadPromise.finally(() => {
        requestCache.current.delete(cacheKey);
      });

      return loadPromise;
    },
    [
      fetchState.isLoading,
      fetchState.abortController,
      showToast,
      scrollToBottom,
      hasLoadedLegacyHistory,
    ],
  );

  // Throttled scroll handler for better performance
  const handleScrollInternal = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;

      const currentScrollTop = scrollTop;
      isScrollingUp.current = currentScrollTop < lastScrollTop.current;
      lastScrollTop.current = currentScrollTop;

      const direction =
        currentScrollTop > lastScrollTopRef.current
          ? 'down'
          : currentScrollTop < lastScrollTopRef.current
            ? 'up'
            : 'still';
      lastScrollTopRef.current = currentScrollTop;

      if (scrollTimeoutRef2.current) {
        clearTimeout(scrollTimeoutRef2.current);
      }

      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      const isScrollingUpDirection = direction === 'up';
      const isNotAtBottom = distanceFromBottom > 100;

      setShowScrollToBottom(isScrollingUpDirection && isNotAtBottom);

      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }

      setIsUserNearTop(scrollTop < SCROLL_THRESHOLD);

      if (
        isScrollingUp.current &&
        scrollTop < SCROLL_THRESHOLD &&
        fetchState.hasMore &&
        !fetchState.isLoading &&
        !isInitialLoading
      ) {
        scrollTimeoutRef.current = setTimeout(() => {
          loadChatHistory(fetchState.currentPage + 1, false);
        }, FETCH_DEBOUNCE_MS);
      }
    },
    [
      fetchState.hasMore,
      fetchState.isLoading,
      fetchState.currentPage,
      isInitialLoading,
      loadChatHistory,
    ],
  );

  const handleScroll = useMemo(
    () => throttle(handleScrollInternal, SCROLL_THROTTLE_MS),
    [handleScrollInternal],
  );

  const handleResize = useCallback(() => {
    setDynamicMaxHeight(window.innerHeight / DYNAMIC_MAX_HEIGHT_RATIO);
    calculateMinHeight();
  }, [calculateMinHeight]);

  const debouncedHandleResize = useMemo(
    () => debounce(handleResize, RESIZE_DEBOUNCE_MS),
    [handleResize],
  );

  const clearAllInput = useCallback(() => {
    setMessage('');
    setInputValue('');
    setCurrentAttachments([]);
    if (attachmentInputAreaRef.current) {
      attachmentInputAreaRef.current.clear();
    }
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.scrollTop = 0;
    }
  }, []);

  const handleTextareaResize = useCallback(
    (textarea: HTMLTextAreaElement, shouldPreserveCursor: boolean = true) => {
      if (textarea.value === '' && currentAttachments.length === 0) {
        textarea.style.height = 'auto';
        textarea.scrollTop = 0;
        return;
      }

      requestAnimationFrame(() => {
        const cursorPosition = textarea.selectionStart;
        const selectionEnd = textarea.selectionEnd;
        const currentScrollTop = textarea.scrollTop;
        const isScrolledToBottom =
          textarea.scrollTop + textarea.clientHeight >= textarea.scrollHeight - 1;
        const isCursorAtEnd = cursorPosition === textarea.value.length;

        const shouldAutoScroll = !shouldPreserveCursor || isScrolledToBottom || isCursorAtEnd;

        textarea.style.height = 'auto';
        const scrollHeight = textarea.scrollHeight;
        const newHeight = Math.min(scrollHeight, dynamicMaxHeight);
        textarea.style.height = `${newHeight}px`;

        if (scrollHeight > dynamicMaxHeight) {
          textarea.scrollTop = shouldAutoScroll ? textarea.scrollHeight : currentScrollTop;
        }

        if (shouldPreserveCursor) {
          textarea.setSelectionRange(cursorPosition, selectionEnd);
        }
      });
    },
    [currentAttachments.length, dynamicMaxHeight],
  );

  const debouncedTextareaResize = useMemo(
    () => debounce(handleTextareaResize, INPUT_DEBOUNCE_MS),
    [handleTextareaResize],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const imageFiles = Array.from(e.clipboardData.items)
        .filter((item) => item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));

      if (imageFiles.length > 0) {
        e.preventDefault();
        attachmentInputAreaRef.current?.processPastedFiles(imageFiles);
      } else {
        setTimeout(() => inputRef.current && handleTextareaResize(inputRef.current, false), 10);
      }
    },
    [handleTextareaResize],
  );

  const { handleSubmit, handleRetryMessage, getMostRecentAssistantMessageId } =
    useMessageSubmission({
      message,
      currentAttachments,
      chatMessages,
      isSearchActive,
      isSending,
      setIsSending,
      setJustSentMessage: () => {
        justSentMessageRef.current = true;
      },
      setCurrentThoughtText,
      lastOptimisticMessageIdRef,
      setChatMessages,
      setIsAssistantTyping,
      clearAllInput,
      scrollToBottom,
      onMessageSent: () => {
        setTimeout(() => {
          calculateMinHeight();
        }, 200);
      },
    });

  const { isDraggingOver } = useDragAndDrop({
    maxAttachments: MAX_ATTACHMENTS_CONFIG,
    currentAttachments,
    setCurrentAttachments,
    showToast,
    inputRef,
  });

  const stableCallbacks = useMemo(
    () => ({
      toggleSearchActive: () => setIsSearchActive((prev) => !prev),
      handleRemoveAttachment: (indexToRemove: number) => {
        attachmentInputAreaRef.current?.removeAttachment(indexToRemove);
      },
      handleRetryLoadHistory: () => loadChatHistory(1, true),
    }),
    [loadChatHistory],
  );

  useLayoutEffect(() => {
    if (!fetchState.isLoading && previousScrollHeight.current > 0 && mainScrollRef.current) {
      const scrollContainer = mainScrollRef.current;
      const heightDifference =
        scrollContainer.scrollHeight - previousScrollHeight.current;

      if (heightDifference > 0) {
        requestAnimationFrame(() => {
          scrollContainer.scrollTop += heightDifference;
          previousScrollHeight.current = 0;
        });
      }
    }
  }, [fetchState.isLoading, chatMessages.length]);

  useEffect(() => {
    if (!initialLoadDone.current) {
      loadChatHistory(1, true);
      getSystemInfo();
      if (inputRef.current) inputRef.current.focus();
      initialLoadDone.current = true;
    }
  }, [loadChatHistory]);

  useEffect(() => {
    if (justSentMessageRef.current && latestUserMessageRef.current) {
      requestAnimationFrame(() => {
        if (latestUserMessageRef.current) {
          latestUserMessageRef.current.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
          });
          justSentMessageRef.current = false;
        }
      });
    }
  }, [chatMessages]);

  useEffect(() => {
    handleResize();
    window.addEventListener('resize', debouncedHandleResize);
    const cleanup = () =>
      window.removeEventListener('resize', debouncedHandleResize);
    cleanupFunctions.current.push(cleanup);

    return cleanup;
  }, [handleResize, debouncedHandleResize]);

  useEffect(() => {
    return () => {
      currentAttachments.forEach((att) => {
        if (att.previewUrl) {
          URL.revokeObjectURL(att.previewUrl);
        }
      });
    };
  }, []);

  useEffect(() => {
    return () => {
      if (fetchState.abortController) {
        fetchState.abortController.abort();
      }

      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }

      const timeoutRef2 = scrollTimeoutRef2.current;
      if (timeoutRef2) {
        clearTimeout(timeoutRef2);
      }

      cleanupFunctions.current.forEach((cleanup) => cleanup());
      cleanupFunctions.current = [];

      requestCache.current.clear();

      currentAttachments.forEach((att) => {
        if (att.previewUrl) {
          URL.revokeObjectURL(att.previewUrl);
        }
      });
    };
  }, [fetchState.abortController, currentAttachments]);

  const handleScrollToBottomClick = useCallback(() => {
    scrollToBottom(true);
  }, [scrollToBottom]);

  return (
    <div className="grid grid-rows-[auto_1fr_auto] h-[100dvh] overflow-hidden bg-background relative">
      {isDraggingOver && (
        <div className="fixed inset-0 bg-primary/10 backdrop-blur-[2px] z-50 flex items-center justify-center">
          <div className="bg-background px-8 py-5 rounded-lg shadow-md border border-primary/20">
            <p className="text-primary font-medium">Drop files to attach</p>
          </div>
        </div>
      )}

      <header
        ref={headerRef}
        className="pt-4 pb-2 px-4 md:px-12 w-full z-30 bg-background backdrop-blur-md border-b border-primary/20"
      >
        <div className="w-full mx-auto flex items-center justify-between">
          <button
            onClick={() => setShowUserProfile(true)}
            className={`flex items-center justify-center w-9 h-9 rounded-full border-2 border-primary/20 hover:border-primary/50 transition-colors text-primary ${
              sessionStatus === 'authenticated' && sessionData?.user?.image ? '' : 'p-2'
            }`}
          >
            <FiMenu size={20} className="text-primary" />
          </button>
          <div className="absolute left-1/2 transform -translate-x-1/2 flex items-center">
            <h1 className="text-lg text-primary md:text-xl font-sans">
              {process.env.NEXT_PUBLIC_APP_NAME}
            </h1>
          </div>
          <button
            onClick={() => setShowMeeraVoice(true)}
            className="flex items-center justify-center w-9 p-2 h-9 rounded-full border-2 border-primary/20 hover:border-primary/50 transition-colors text-primary"
            aria-label="Open voice assistant"
          >
            <IoCallSharp size={24} className="text-primary" />
          </button>
        </div>
      </header>

      <main
        ref={mainScrollRef}
        className="overflow-y-auto w-full scroll-pt-2.5"
        onScroll={handleScroll}
      >
        <div className="px-2 sm:px-0 py-6 w-full max-w-full sm:max-w-2xl md:max-w-3xl mx-auto">
          {isInitialLoading && (
            <div className="flex justify-center items-center h-[calc(100vh-15rem)]">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          )}

          {fetchState.error && !isInitialLoading && chatMessages.length === 0 && (
            <div className="flex flex-col justify-center items-center h-[calc(100vh-10rem)] text-center">
              <p className="text-red-500 mb-2">{fetchState.error}</p>
              <button
                onClick={stableCallbacks.handleRetryLoadHistory}
                className="px-4 py-2 bg-primary text-background rounded-md hover:bg-primary/90 transition-colors"
              >
                Try Again
              </button>
            </div>
          )}

          {!isInitialLoading && !fetchState.error && chatMessages.length === 0 && (
            <div className="flex justify-center items-center h-[calc(100vh-10rem)]">
              <p className="text-primary/70">No messages yet. Start the conversation!</p>
            </div>
          )}

          {!isInitialLoading && chatMessages.length > 0 && (
            <div className="flex flex-col space-y-0 w-full ">
              {fetchState.isLoading && isUserNearTop && (
                <div className="flex justify-center py-4 sticky top-0 z-10">
                  <div className="bg-background/80 backdrop-blur-sm rounded-full p-2 shadow-sm border border-primary/10">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                  </div>
                </div>
              )}

              {messagesByDate.map(([dateKey, messages]) => {
                const dateHeader = formatWhatsAppStyle(dateKey);

                return (
                  <div key={dateKey} className="date-group relative w-full">
                    {dateHeader && (
                      <div className="sticky pt-2 z-20 flex justify-center my-3 top-0">
                        <div className="bg-background text-primary text-xs px-4 py-1.5 rounded-full shadow-sm border border-primary/10">
                          {dateHeader}
                        </div>
                      </div>
                    )}

                    <div className="messages-container">
                      {messages.map((item) => {
                        if (item.type === 'call_session') {
                          return (
                            <MemoizedCallSessionItem
                              key={item.id}
                              messages={item.messages}
                            />
                          );
                        }

                        const msg = item.message;
                        const isStreamingMessage =
                          isSending &&
                          msg.content_type === 'assistant' &&
                          msg.message_id === lastMessage?.message_id &&
                          msg.finish_reason == null;

                        const isLastFailedMessage = msg.message_id === lastFailedMessageId;

                        const storedThoughts = (msg as unknown as { thoughts?: string }).thoughts;
                        const effectiveThoughtText =
                          currentThoughtText || storedThoughts || undefined;

                        // Changed logic:
                        // show typing only while assistant bubble is still empty
                        const shouldShowTypingIndicator =
                          msg.content_type === 'assistant' &&
                          msg.message_id === lastMessage?.message_id &&
                          isAssistantTyping &&
                          (!msg.content || msg.content.trim().length === 0);

                        const isLatestUserMessage =
                          msg.content_type === 'user' &&
                          msg.message_id === lastOptimisticMessageIdRef.current;
                        const isLatestAssistantMessage =
                          msg.content_type === 'assistant' &&
                          msg.message_id === getMostRecentAssistantMessageId();

                        return (
                          <div
                            id={`message-${msg.message_id}`}
                            key={msg.message_id}
                            ref={
                              isLatestUserMessage
                                ? latestUserMessageRef
                                : isLatestAssistantMessage
                                  ? latestAssistantMessageRef
                                  : null
                            }
                            className="message-item-wrapper w-full transform-gpu will-change-transform "
                          >
                            <MemoizedRenderedMessageItem
                              message={msg}
                              isStreaming={isStreamingMessage}
                              onRetry={handleRetryMessage}
                              isLastFailedMessage={isLastFailedMessage}
                              showTypingIndicator={shouldShowTypingIndicator}
                              thoughtText={effectiveThoughtText}
                              hasMinHeight={isLatestAssistantMessage}
                              dynamicMinHeight={dynamicMinHeight}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              <div ref={spacerRef} className="h-0" />
            </div>
          )}
        </div>
      </main>

      <footer ref={footerRef} className="w-full z-40 p-2 md:pr-[13px] bg-transparent">
        <div className="relative">
          <div className="absolute bottom_full left-0 right-0 flex flex-col items-center mb-2">
            {!isSubscriptionLoading &&
              !isSubscriptionError &&
              subscriptionData?.plan_type === 'paid' &&
              !(new Date(subscriptionData?.subscription_end_date || 0) >= new Date()) && (
                <div className="w-fit mx-auto px-4 py-2 rounded-md border bg-[#E7E5DA]/80 backdrop-blur-sm shadow-md text-dark break-words border-red-500">
                  <span className="text-sm">
                    Your subscription has expired.{' '}
                    <span
                      className="text-primary font-medium cursor-pointer underline"
                      onClick={() =>
                        openModal('subscription_has_ended_renew_here_toast_clicked', true)
                      }
                    >
                      Renew here
                    </span>
                  </span>
                </div>
              )}

            {!isSubscriptionLoading &&
              !isSubscriptionError &&
              subscriptionData?.plan_type !== 'paid' &&
              subscriptionData?.tokens_left != null &&
              subscriptionData.tokens_left <= 5000 && (
                <div className="w-fit mx_auto px-4 py-2 rounded-md border bg-[#E7E5DA]/80 backdrop-blur-sm shadow-md text-dark break-words border-primary">
                  <span className="text-sm">
                    You have {subscriptionData?.tokens_left} tokens left.{' '}
                  </span>
                  <span
                    className="text-primary font-medium cursor-pointer underline"
                    onClick={() => openModal('5000_tokens_left_toast_clicked', true)}
                  >
                    Add more
                  </span>
                </div>
              )}

            {showScrollToBottom && (
              <button
                onClick={handleScrollToBottomClick}
                className=" p-2 rounded-full bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 transition-all duration-200 hover:scale-105 shadow-md backdrop-blur-sm hidden"
                title="Scroll to bottom"
              >
                <MdKeyboardArrowDown size={20} />
              </button>
            )}
            <div className="w-full pt-1 flex justify-center">
              <Toast position="conversation" />
            </div>
          </div>

          <form onSubmit={handleSubmit} className="w-full max-w-3xl mx-auto bg-transparent mt-[-25px]">
            <div className="flex flex-col rounded-3xl bg-card backdrop-blur-md border border-primary/20 shadow-lg transition-all duration-200 transform-gpu will-change-transform">
              {currentAttachments.length > 0 && (
                <div className="flex flex-wrap gap-2 px-4 pt-2.5 pb-1">
                  {currentAttachments.map((att, index) => (
                    <MemoizedAttachmentPreview
                      key={`${att.file?.name}-${index}`}
                      attachment={att}
                      index={index}
                      onRemove={stableCallbacks.handleRemoveAttachment}
                    />
                  ))}
                </div>
              )}

              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={(e) => {
                  setInputValue(e.target.value);
                  debouncedTextareaResize(e.target);
                }}
                placeholder="Ask Meera"
                className="w-full px-4 py-3 bg-transparent border-none resize-none outline-none text-primary placeholder-primary/50 text-base scrollbar-thin transform-gpu will-change-transform"
                style={{
                  minHeight: '52px',
                  transition: 'height 0.1s ease-out',
                  contain: 'layout',
                }}
                rows={1}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e);
                  }
                }}
                onPaste={handlePaste}
              />

              <div className="flex flex-row items-center justify-between px-3 pb-1.5">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={stableCallbacks.toggleSearchActive}
                    className={`py-2 px-3 rounded-2xl flex items-center justify-center gap-2 border border-primary/20 focus:outline-none transition-all duration-150 ease-in-out text-sm font-medium cursor-pointer transform-gpu will-change-transform  ${
                      isSearchActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-gray-500 hover:bg-gray-50'
                    }`}
                    title="Search"
                  >
                    <FiGlobe size={16} />
                    <span>Search</span>
                  </button>
                </div>

                <div className="flex items-center gap-1">
                  <AttachmentInputArea
                    ref={attachmentInputAreaRef}
                    onAttachmentsChange={setCurrentAttachments}
                    messageValue={message}
                    resetInputHeightState={() => {}}
                    maxAttachments={MAX_ATTACHMENTS_CONFIG}
                    existingAttachments={currentAttachments}
                  >
                    <span></span>
                  </AttachmentInputArea>

                  <button
                    type="submit"
                    className={`rounded-full flex items-center justify-center focus:outline-none transition-all duration-150 ease-in-out cursor-pointer min-w-[38px] min-h-[38px] transform-gpu will-change-transform ${
                      canSubmit
                        ? 'bg-primary text-background hover:bg-primary/90 hover:scale-105'
                        : 'bg-primary/20 text-primary/50 cursor-not-allowed'
                    }`}
                    disabled={!canSubmit}
                    title="Send message"
                  >
                    <FiArrowUp size={20} />
                  </button>
                </div>
              </div>
            </div>
          </form>
        </div>
      </footer>

      <UserProfile isOpen={showUserProfile} onClose={() => setShowUserProfile(false)} />
      <MeeraVoice
        isOpen={showMeeraVoice}
        onClose={(wasConnected) => {
          setShowMeeraVoice(false);
          if (wasConnected) {
            loadChatHistory(1, true);
          }
        }}
      />
    </div>
  );
};

export default Conversation;
