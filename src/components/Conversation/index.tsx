'use client';

import { chatService } from '@/app/api/services/chat';
import { ImagesView, type GalleryImageItem } from '@/components/ImagesView';
import { MeeraVoice } from '@/components/MeeraVoice';
import { Sidebar } from '@/components/Sidebar';
import { SupportPanel } from '@/components/ui/SupportPanel';
import { Toast } from '@/components/ui/Toast';
import { useToast } from '@/components/ui/ToastProvider';
import { usePricingModal } from '@/contexts/PricingModalContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useDragAndDrop } from '@/hooks/useDragAndDrop';
import { useMessageSubmission } from '@/hooks/useMessageSubmission';
import { useSubscriptionStatus } from '@/hooks/useSubscriptionStatus';
import { useTotalCostTokens } from '@/hooks/useTotalCostTokens';
import { formatWhatsAppStyle, getLocalDateKeyFromTimestamp } from '@/lib/dateUtils';
import { getSystemInfo } from '@/lib/deviceInfo';
import { supabase } from '@/lib/supabaseClient';
import { debounce, throttle } from '@/lib/utils';
import { ChatAttachmentFromServer, ChatAttachmentInputState, ChatMessageFromServer } from '@/types/chat';
import { useSession } from 'next-auth/react';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FiArrowUp, FiGlobe, FiMenu, FiPaperclip } from 'react-icons/fi';
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
const JUMP_DOM_POLL_INTERVAL_MS = 250;
const JUMP_MAX_PAGE_LOADS = 200;
const JUMP_SUPPRESS_AUTOLOAD_MS = 1400;
const JUMP_MAX_WAIT_MS = 18000;
const JUMP_RENDER_WAIT_TIMEOUT_MS = 1800;
const IMAGE_HISTORY_PAGE_SIZE = 48;

type SidebarView = 'chat' | 'images';

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

const prependUniqueId = (ids: string[], targetId: string): string[] => {
  if (ids.includes(targetId)) return ids;
  return [targetId, ...ids];
};

const removeId = (ids: string[], targetId: string): string[] => {
  return ids.filter((id) => id !== targetId);
};

const upsertSnapshot = (messages: ChatMessageFromServer[], target: ChatMessageFromServer): ChatMessageFromServer[] => {
  const withoutTarget = messages.filter((message) => message.message_id !== target.message_id);
  return [target, ...withoutTarget];
};

const removeSnapshot = (messages: ChatMessageFromServer[], targetId: string): ChatMessageFromServer[] => {
  return messages.filter((message) => message.message_id !== targetId);
};

const normalizeContextText = (value: string): string => value.replace(/\s+/g, ' ').trim();
const waitForMs = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const asTrimmedString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const firstNonEmpty = (...values: unknown[]): string => {
  for (const value of values) {
    const parsed = asTrimmedString(value);
    if (parsed) return parsed;
  }
  return '';
};

const isImageAttachment = (attachment: { type?: string; url?: string }): boolean => {
  const type = String(attachment.type || '').toLowerCase();
  return Boolean(attachment.url && (type === 'image' || type.startsWith('image/')));
};

const normalizeAttachments = (value: unknown): ChatAttachmentFromServer[] => {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const source = item as Record<string, unknown>;
      const url = typeof source.url === 'string' ? source.url : '';
      if (!url) return null;

      const type = typeof source.type === 'string' ? source.type : 'image';
      const name = typeof source.name === 'string' ? source.name : 'attachment';
      const size = typeof source.size === 'number' ? source.size : undefined;

      return {
        type,
        url,
        name,
        size,
      } as ChatAttachmentFromServer;
    })
    .filter((item): item is ChatAttachmentFromServer => Boolean(item));
};

const mapRealtimeMessageRow = (row: unknown): ChatMessageFromServer | null => {
  if (!row || typeof row !== 'object') return null;
  const source = row as Record<string, unknown>;

  const messageId = typeof source.message_id === 'string' ? source.message_id : '';
  if (!messageId) return null;

  const rawContentType = typeof source.content_type === 'string' ? source.content_type : 'user';
  const contentType =
    rawContentType === 'assistant' || rawContentType === 'system' ? rawContentType : 'user';

  const timestamp =
    typeof source.timestamp === 'string' && source.timestamp
      ? source.timestamp
      : new Date().toISOString();

  return {
    message_id: messageId,
    content_type: contentType,
    content: typeof source.content === 'string' ? source.content : '',
    timestamp,
    session_id: typeof source.session_id === 'string' ? source.session_id : undefined,
    is_call: Boolean(source.is_call),
    attachments: normalizeAttachments(source.attachments),
    failed: false,
    finish_reason: null,
  };
};

const mapRealtimeStarredRow = (row: unknown): ChatMessageFromServer | null => {
  if (!row || typeof row !== 'object') return null;
  const source = row as Record<string, unknown>;

  const messageId = typeof source.message_id === 'string' ? source.message_id : '';
  if (!messageId) return null;

  const snapshotTimestamp =
    typeof source.snapshot_timestamp === 'string' && source.snapshot_timestamp
      ? source.snapshot_timestamp
      : typeof source.starred_at === 'string' && source.starred_at
        ? source.starred_at
        : new Date(0).toISOString();

  const snapshotContentType = source.snapshot_content_type === 'user' ? 'user' : 'assistant';

  const userContext = typeof source.user_context === 'string' ? source.user_context : '';
  const summary = typeof source.summary === 'string' ? source.summary : '';

  return {
    message_id: messageId,
    content_type: snapshotContentType,
    content: typeof source.snapshot_content === 'string' ? source.snapshot_content : '',
    timestamp: snapshotTimestamp,
    user_context: userContext,
    summary,
    session_id: undefined,
    is_call: false,
    attachments: [],
    failed: false,
    finish_reason: null,
  };
};

const extractGalleryImagesFromMessages = (messages: ChatMessageFromServer[]): GalleryImageItem[] => {
  const sortedMessages = [...messages].sort((a, b) => {
    const aTime = new Date(a.timestamp).getTime();
    const bTime = new Date(b.timestamp).getTime();
    const safeA = Number.isFinite(aTime) ? aTime : 0;
    const safeB = Number.isFinite(bTime) ? bTime : 0;
    return safeA - safeB;
  });

  const items: GalleryImageItem[] = [];
  const seen = new Set<string>();

  sortedMessages.forEach((message, index) => {
    if (message.content_type !== 'assistant') return;

    const imageAttachments = (message.attachments ?? []).filter(isImageAttachment);
    if (imageAttachments.length === 0) return;

    let prompt = normalizeContextText(message.user_context ?? '');

    if (!prompt) {
      const assistantText = normalizeContextText(message.content ?? '');
      if (
        assistantText &&
        assistantText.toLowerCase() !== 'image generated.' &&
        assistantText.toLowerCase() !== 'here is your image.'
      ) {
        prompt = assistantText;
      }
    }

    if (!prompt) {
      for (let pointer = index - 1; pointer >= 0; pointer -= 1) {
        const candidate = sortedMessages[pointer];
        if (candidate.content_type === 'user' && candidate.content.trim()) {
          prompt = normalizeContextText(candidate.content);
          break;
        }
      }
    }

    imageAttachments.forEach((attachment, attachmentIndex) => {
      const url = attachment.url?.trim();
      if (!url) return;

      const dedupeKey = `${message.message_id}:${url}:${attachmentIndex}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);

      items.push({
        id: dedupeKey,
        url,
        name: attachment.name || `image-${attachmentIndex + 1}`,
        timestamp: message.timestamp,
        prompt,
      });
    });
  });

  return items.sort((a, b) => {
    const aTime = new Date(a.timestamp).getTime();
    const bTime = new Date(b.timestamp).getTime();
    const safeA = Number.isFinite(aTime) ? aTime : 0;
    const safeB = Number.isFinite(bTime) ? bTime : 0;
    return safeB - safeA;
  });
};

const generateStarSummary = (text: string): string => {
  const normalized = normalizeContextText(text);
  if (!normalized) return 'Saved Memory';

  const words = normalized.split(' ');
  const summary = words.slice(0, 5).join(' ');
  return words.length > 5 ? `${summary}...` : summary;
};

const getUserContextForStar = (messages: ChatMessageFromServer[], targetMessageId: string): string => {
  const targetIndex = messages.findIndex((item) => item.message_id === targetMessageId);
  if (targetIndex <= 0) return '';

  const previousMessage = messages[targetIndex - 1];
  if (!previousMessage || previousMessage.content_type !== 'user') return '';

  return normalizeContextText(previousMessage.content);
};

const withStarMetadata = (message: ChatMessageFromServer, userContext: string, summary: string): ChatMessageFromServer => {
  return {
    ...message,
    user_context: userContext,
    summary,
  };
};

const MemoizedRenderedMessageItem = React.memo(RenderedMessageItem, (prevProps, nextProps) => {
  const prevAttachments = prevProps.message.attachments ?? [];
  const nextAttachments = nextProps.message.attachments ?? [];

  const attachmentsEqual =
    prevAttachments.length === nextAttachments.length &&
    JSON.stringify(prevAttachments) === JSON.stringify(nextAttachments);

  return (
    prevProps.message.message_id === nextProps.message.message_id &&
    prevProps.message.content === nextProps.message.content &&
    prevProps.isStreaming === nextProps.isStreaming &&
    prevProps.isStarred === nextProps.isStarred &&
    prevProps.isLastFailedMessage === nextProps.isLastFailedMessage &&
    prevProps.message.failed === nextProps.message.failed &&
    prevProps.showTypingIndicator === nextProps.showTypingIndicator &&
    prevProps.thoughtText === nextProps.thoughtText &&
    prevProps.hasMinHeight === nextProps.hasMinHeight &&
    prevProps.dynamicMinHeight === nextProps.dynamicMinHeight &&
    attachmentsEqual
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
  const [message, setMessage] = useState('');
  const [inputValue, setInputValue] = useState('');

  const [currentAttachments, setCurrentAttachments] = useState<ChatAttachmentInputState[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessageFromServer[]>([]);
  const [isSearchActive, setIsSearchActive] = useState(true);
  const [currentThoughtText, setCurrentThoughtText] = useState('');
  const [dynamicMinHeight, setDynamicMinHeight] = useState<number>(500);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [starredMessageIds, setStarredMessageIds] = useState<string[]>([]);
  const [starredMessageSnapshots, setStarredMessageSnapshots] = useState<ChatMessageFromServer[]>([]);
  const [isSidebarVisible, setIsSidebarVisible] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [activeSidebarView, setActiveSidebarView] = useState<SidebarView>('chat');
  const [galleryImages, setGalleryImages] = useState<GalleryImageItem[]>([]);
  const [isGalleryLoading, setIsGalleryLoading] = useState(false);
  const [galleryPage, setGalleryPage] = useState(0);
  const [galleryHasMore, setGalleryHasMore] = useState(true);
  const [hasLoadedGallery, setHasLoadedGallery] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);

  const [showSupportPanel, setShowSupportPanel] = useState(false);
  const [showMeeraVoice, setShowMeeraVoice] = useState(false);

  const [legacyUserId, setLegacyUserId] = useState<string | null>(null);
  const [hasLoadedLegacyHistory, setHasLoadedLegacyHistory] = useState(false);

  const [isSending, setIsSending] = useState(false);
  const [isAssistantTyping, setIsAssistantTyping] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isUserNearTop, setIsUserNearTop] = useState(false);

  // Critical: gate Send until attachments are fully uploaded
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);

  const [fetchState, setFetchState] = useState<FetchState>({
    isLoading: false,
    currentPage: 0,
    hasMore: true,
    error: null,
    abortController: null,
  });

  const [dynamicMaxHeight, setDynamicMaxHeight] = useState(200);

  // Sticky date bubble (show only while user is scrolling)
  const [showDateSticky, setShowDateSticky] = useState(false);
  const hideDateStickyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const attachmentInputAreaRef = useRef<AttachmentInputAreaRef>(null);
  const lastOptimisticMessageIdRef = useRef<string | null>(null);
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const initialLoadDone = useRef(false);
  const justSentMessageRef = useRef(false);
  const spacerRef = useRef<HTMLDivElement>(null);

  const headerRef = useRef<HTMLElement>(null);
  const footerRef = useRef<HTMLElement>(null);
  const latestUserMessageRef = useRef<HTMLDivElement | null>(null);
  const latestAssistantMessageRef = useRef<HTMLDivElement | null>(null);

  const requestCache = useRef<Map<string, Promise<unknown>>>(new Map());
  const cleanupFunctions = useRef<Array<() => void>>([]);
  const fetchStateRef = useRef(fetchState);
  const chatMessagesRef = useRef<ChatMessageFromServer[]>(chatMessages);
  const starMutationInFlightRef = useRef<Set<string>>(new Set());

  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastScrollTop = useRef(0);
  const isScrollingUp = useRef(false);
  const previousScrollHeight = useRef(0);
  const highlightTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isJumpingRef = useRef(false);
  const suppressAutoLoadUntilRef = useRef(0);

  const lastScrollTopRef = useRef(0);
  const scrollTimeoutRef2 = useRef<NodeJS.Timeout | null>(null);

  const { data: sessionData } = useSession();
  const { user: supabaseUser, userId: supabaseUserId } = useCurrentUser();
  const { formattedTotalCostTokens } = useTotalCostTokens(supabaseUserId);
  const {
    data: subscriptionData,
    isLoading: isSubscriptionLoading,
    isError: isSubscriptionError,
  } = useSubscriptionStatus();
  const { showToast, clearToasts } = useToast();
  const { openModal } = usePricingModal();

  useEffect(() => {
    fetchStateRef.current = fetchState;
  }, [fetchState]);

  useEffect(() => {
    chatMessagesRef.current = chatMessages;
  }, [chatMessages]);

  const debouncedSetMessage = useMemo(() => debounce((value: string) => setMessage(value), INPUT_DEBOUNCE_MS), []);

  useEffect(() => {
    debouncedSetMessage(inputValue);
  }, [inputValue, debouncedSetMessage]);

  const lastFailedMessageId = useMemo(() => {
    for (let i = chatMessages.length - 1; i >= 0; i--) {
      const msg = chatMessages[i];
      if (msg.content_type === 'user' && msg.failed) return msg.message_id;
    }
    return null;
  }, [chatMessages]);

  const starredMessageIdSet = useMemo(() => new Set(starredMessageIds), [starredMessageIds]);

  const loadPersistedStarredMessages = useCallback(
    async (showErrorToast: boolean): Promise<'ok' | 'unauthorized' | 'error'> => {
      const response = await chatService.getStarredMessages();

      if (response.message === 'unauthorized') {
        return 'unauthorized';
      }

      if (response.message !== 'ok') {
        if (showErrorToast) {
          showToast('Unable to sync starred messages right now.', {
            type: 'error',
            position: 'conversation',
          });
        }
        return 'error';
      }

      const persistedMessages = response.data as ChatMessageFromServer[];
      const responseWithIds = response as { ids?: string[] };
      const persistedIds = Array.isArray(responseWithIds.ids)
        ? responseWithIds.ids
        : persistedMessages.map((messageItem) => messageItem.message_id);

      setStarredMessageIds(persistedIds);
      setStarredMessageSnapshots(persistedMessages);

      return 'ok';
    },
    [showToast],
  );

  const starredMessages = useMemo(() => {
    const loadedMessageMap = new Map(chatMessages.map((msg) => [msg.message_id, msg]));
    const snapshotMap = new Map(starredMessageSnapshots.map((msg) => [msg.message_id, msg]));

    return [...starredMessageIds]
      .map((messageId) => {
        const loaded = loadedMessageMap.get(messageId);
        const snapshot = snapshotMap.get(messageId);

        if (!loaded) return snapshot;
        if (!snapshot) return loaded;

        return {
          ...loaded,
          user_context: (snapshot.user_context ?? '').trim() || loaded.user_context,
          summary: (snapshot.summary ?? '').trim() || loaded.summary,
        };
      })
      .filter((msg): msg is ChatMessageFromServer => Boolean(msg));
  }, [chatMessages, starredMessageIds, starredMessageSnapshots]);

  const mergeMessagesIntoState = useCallback((incoming: ChatMessageFromServer[]) => {
    if (!incoming.length) return;

    setChatMessages((prev) => {
      const map = new Map(prev.map((message) => [message.message_id, message]));

      incoming.forEach((message) => {
        const existing = map.get(message.message_id);
        if (existing) {
          map.set(message.message_id, {
            ...existing,
            ...message,
            attachments: message.attachments ?? existing.attachments ?? [],
            user_context: message.user_context ?? existing.user_context,
            summary: message.summary ?? existing.summary,
          });
          return;
        }

        map.set(message.message_id, {
          ...message,
          attachments: message.attachments ?? [],
        });
      });

      return Array.from(map.values()).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    });
  }, []);

  const mergeGalleryItems = useCallback((incoming: GalleryImageItem[], reset: boolean = false) => {
    if (!incoming.length && !reset) return;

    setGalleryImages((prev) => {
      const merged = reset ? [] : [...prev];
      const seen = new Set(merged.map((item) => item.id));

      incoming.forEach((item) => {
        if (seen.has(item.id)) return;
        seen.add(item.id);
        merged.push(item);
      });

      return merged.sort((a, b) => {
        const aTime = new Date(a.timestamp).getTime();
        const bTime = new Date(b.timestamp).getTime();
        return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
      });
    });
  }, []);

  const findNearestMessageIdByTimestamp = useCallback(
    (
      timestamp: string,
      messages: ChatMessageFromServer[],
      preferredContentType?: ChatMessageFromServer['content_type'],
    ): string | null => {
      const targetTime = new Date(timestamp).getTime();
      if (!Number.isFinite(targetTime)) return null;

      const findNearestFrom = (source: ChatMessageFromServer[]): string | null => {
        let nearestMessageId: string | null = null;
        let nearestDiff = Number.POSITIVE_INFINITY;

        source.forEach((message) => {
          const messageTime = new Date(message.timestamp).getTime();
          if (!Number.isFinite(messageTime)) return;

          const diff = Math.abs(messageTime - targetTime);
          if (diff < nearestDiff) {
            nearestDiff = diff;
            nearestMessageId = message.message_id;
          }
        });

        return nearestMessageId;
      };

      if (preferredContentType) {
        const preferred = messages.filter((message) => message.content_type === preferredContentType);
        const preferredNearest = findNearestFrom(preferred);
        if (preferredNearest) return preferredNearest;
      }

      return findNearestFrom(messages);
    },
    [],
  );

  const waitForMessageElement = useCallback(async (messageId: string, timeoutMs = JUMP_RENDER_WAIT_TIMEOUT_MS) => {
    const domId = `message-${messageId}`;
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const element = document.getElementById(domId);
      if (element) return element;
      await waitForMs(50);
    }

    return null;
  }, []);

  const loadGeneratedImages = useCallback(
    async (force = false) => {
      if (isGalleryLoading) return;
      if (!force && !galleryHasMore) return;

      const nextPage = force ? 1 : galleryPage + 1;

      setIsGalleryLoading(true);

      try {
        const response = await chatService.getImageHistory(nextPage, IMAGE_HISTORY_PAGE_SIZE);

        if (response.message === 'unauthorized') {
          setGalleryImages([]);
          setGalleryHasMore(false);
          setGalleryPage(0);
          setHasLoadedGallery(true);
          return;
        }

        if (response.message !== 'ok') {
          throw new Error('Failed to load image history');
        }

        const pageMessages = (response.data as ChatMessageFromServer[]) || [];
        const pageImages = extractGalleryImagesFromMessages(pageMessages);

        mergeGalleryItems(pageImages, force);

        const responseWithMeta = response as { hasMore?: boolean };
        setGalleryHasMore(Boolean(responseWithMeta.hasMore));
        setGalleryPage(nextPage);
        setHasLoadedGallery(true);
      } catch (error) {
        console.error('Unable to load generated images', error);
        showToast('Unable to load generated images right now.', {
          type: 'error',
          position: 'conversation',
        });
      } finally {
        setIsGalleryLoading(false);
      }
    },
    [galleryHasMore, galleryPage, isGalleryLoading, mergeGalleryItems, showToast],
  );

  const handleLoadMoreImages = useCallback(() => {
    if (isGalleryLoading || !galleryHasMore) return;
    void loadGeneratedImages(false);
  }, [galleryHasMore, isGalleryLoading, loadGeneratedImages]);

  const handleSelectSidebarView = useCallback(
    (view: SidebarView) => {
      setActiveSidebarView(view);

      if (view === 'images') {
        const inMemoryImages = extractGalleryImagesFromMessages(chatMessages);
        if (inMemoryImages.length > 0) {
          mergeGalleryItems(inMemoryImages);
        }
      }

      if (view === 'images' && !hasLoadedGallery) {
        void loadGeneratedImages(true);
      }
    },
    [chatMessages, hasLoadedGallery, loadGeneratedImages, mergeGalleryItems],
  );

  const toggleStarForMessage = useCallback(
    (target: ChatMessageFromServer) => {
      if (!target.content.trim()) return;
      if (starMutationInFlightRef.current.has(target.message_id)) return;

      const isCurrentlyStarred = starredMessageIdSet.has(target.message_id);
      const userContext =
        target.content_type === 'assistant'
          ? getUserContextForStar(chatMessages, target.message_id)
          : '';
      const summary = generateStarSummary(userContext || target.content);
      const optimisticSnapshot = withStarMetadata(target, userContext, summary);

      starMutationInFlightRef.current.add(target.message_id);

      setStarredMessageIds((prev) =>
        isCurrentlyStarred ? removeId(prev, target.message_id) : prependUniqueId(prev, target.message_id),
      );
      setStarredMessageSnapshots((prev) =>
        isCurrentlyStarred ? removeSnapshot(prev, target.message_id) : upsertSnapshot(prev, optimisticSnapshot),
      );

      void chatService
        .setMessageStar(target.message_id, !isCurrentlyStarred, {
          content: target.content,
          content_type: target.content_type,
          timestamp: target.timestamp,
          user_context: userContext,
          summary,
        })
        .then((response) => {
          if (response.message !== 'ok') {
            throw new Error('Star persistence failed');
          }
        })
        .catch((error) => {
          console.error('Failed to update starred message', error);

          setStarredMessageIds((prev) =>
            isCurrentlyStarred ? prependUniqueId(prev, target.message_id) : removeId(prev, target.message_id),
          );
          setStarredMessageSnapshots((prev) =>
            isCurrentlyStarred ? upsertSnapshot(prev, optimisticSnapshot) : removeSnapshot(prev, target.message_id),
          );

          showToast('Failed to update starred message. Please try again.', {
            type: 'error',
            position: 'conversation',
          });
        })
        .finally(() => {
          starMutationInFlightRef.current.delete(target.message_id);
        });
    },
    [chatMessages, showToast, starredMessageIdSet],
  );

  const flashJumpTarget = useCallback((messageId: string) => {
    setHighlightedMessageId(messageId);
    if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    highlightTimeoutRef.current = setTimeout(() => {
      setHighlightedMessageId((current) => (current === messageId ? null : current));
    }, 2000);
  }, []);

  const calculateMinHeight = useCallback(() => {
    const viewportHeight = window.innerHeight;
    const headerHeight = headerRef.current?.offsetHeight || 80;
    const footerHeight = (footerRef.current?.offsetHeight || 0) - 45;
    const userMessageHeight = latestUserMessageRef.current?.offsetHeight || 0;

    const calculatedMinHeight = Math.max(0, viewportHeight - headerHeight - footerHeight - userMessageHeight - 100);

    setDynamicMinHeight(calculatedMinHeight);
  }, []);

  const processMessagesForDisplay = useCallback((messages: ChatMessageFromServer[]): [string, ChatDisplayItem[]][] => {
    const grouped: Record<string, ChatDisplayItem[]> = {};

    const groupCallSessions = (msgs: ChatMessageFromServer[]): ChatDisplayItem[] => {
      const displayItems: ChatDisplayItem[] = [];
      const callSessions: Record<string, ChatMessageFromServer[]> = {};

      msgs.forEach((msg) => {
        if (msg.is_call && msg.session_id) {
          if (!callSessions[msg.session_id]) callSessions[msg.session_id] = [];
          callSessions[msg.session_id].push(msg);
        } else {
          displayItems.push({ type: 'message', message: msg, id: msg.message_id });
        }
      });

      for (const sessionId in callSessions) {
        const sessionMessages = callSessions[sessionId].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
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
      const dateKey = getLocalDateKeyFromTimestamp(timestamp);

      if (!grouped[dateKey]) grouped[dateKey] = [];
      grouped[dateKey].push(item);
    });

    return Object.entries(grouped).sort(([a], [b]) => {
      if (a === 'unknown') return 1;
      if (b === 'unknown') return -1;
      return a.localeCompare(b);
    });
  }, []);

  const messagesByDate = useMemo(
    () => processMessagesForDisplay(chatMessages),
    [chatMessages, processMessagesForDisplay],
  );

  const lastMessage = chatMessages.length > 0 ? chatMessages[chatMessages.length - 1] : null;

  const hasPendingUploads = useMemo(() => {
    if (isUploadingAttachments) return true;
    return currentAttachments.some((att) => {
      const storagePath = (att as unknown as { storagePath?: string }).storagePath || '';
      const publicUrl = (att as unknown as { publicUrl?: string }).publicUrl || '';
      return !publicUrl || !storagePath || storagePath.startsWith('__uploading__');
    });
  }, [currentAttachments, isUploadingAttachments]);

  const canSubmit = useMemo(
    () => (message.trim() || currentAttachments.length > 0) && !isSending && !hasPendingUploads,
    [
      message,
      currentAttachments.length,
      isSending,
      hasPendingUploads,
    ],
  );

  const scrollToBottom = useCallback((smooth: boolean = true, force: boolean = false) => {
    const el = mainScrollRef.current;
    if (!el) return;
    if (!force) return;

    requestAnimationFrame(() => {
      el.scrollTo({
        top: el.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto',
      });
    });
  }, []);

  useEffect(() => {
    const email = sessionData?.user?.email;
    if (!email) return;

    const findLegacyUser = async () => {
      try {
        const { data, error } = await supabase.from('users').select('id').eq('email', email).limit(1).maybeSingle();

        if (!error && data?.id) setLegacyUserId(data.id as string);
      } catch (err) {
        console.error('Error fetching legacy user', err);
      }
    };

    findLegacyUser();
  }, [sessionData?.user?.email]);

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

        if (error || !data || data.length === 0) {
          setHasLoadedLegacyHistory(true);
          setIsInitialLoading(false);
          return;
        }

        const mapped: ChatMessageFromServer[] = (data as LegacyMessageRow[]).map((row) => ({
          message_id: row.message_id,
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
          setTimeout(() => scrollToBottom(false, true), 50);
        });
      } catch (err) {
        console.error('Error loading legacy messages', err);
      } finally {
        setIsInitialLoading(false);
      }
    };

    loadLegacyHistory();
  }, [
    legacyUserId,
    hasLoadedLegacyHistory,
    scrollToBottom,
  ]);

  const loadChatHistory = useCallback(
    async (page: number = 1, isInitial: boolean = false, retryCount = 0) => {
      const cacheKey = `${page}-${isInitial}`;

      if (requestCache.current.has(cacheKey)) return requestCache.current.get(cacheKey);
      const currentFetchState = fetchStateRef.current;
      if (currentFetchState.isLoading && !isInitial) return;

      if (currentFetchState.abortController && !isInitial) currentFetchState.abortController.abort();
      const abortController = new AbortController();

      const loadPromise = (async () => {
        setFetchState((prev) => ({
          ...prev,
          isLoading: true,
          error: null,
          abortController,
          currentPage: page,
        }));

        if (isInitial) setIsInitialLoading(true);

        try {
          const response = await chatService.getChatHistory(page);
          if (abortController.signal.aborted) return;

          if (response.data && response.data.length > 0) {
            const rawMessages = response.data as ChatMessageFromServer[];

            const messages = rawMessages
              .map((msg) => ({
                ...msg,
                attachments: msg.attachments ?? [],
              }))
              .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

            if (isInitial && !hasLoadedLegacyHistory) {
              setChatMessages(messages);
              requestAnimationFrame(() => {
                setTimeout(() => scrollToBottom(false, true), 50);
              });
            } else if (!isInitial) {
              const scrollContainer = mainScrollRef.current;
              if (scrollContainer) previousScrollHeight.current = scrollContainer.scrollHeight;

              mergeMessagesIntoState(messages);
            }

            setFetchState((prev) => ({
              ...prev,
              isLoading: false,
              hasMore: response.data.length >= 20,
              error: null,
              abortController: null,
            }));
          } else {
            setFetchState((prev) => ({
              ...prev,
              isLoading: false,
              hasMore: false,
              error: null,
              abortController: null,
            }));

            if (isInitial && !hasLoadedLegacyHistory) setChatMessages([]);
          }
        } catch (error: unknown) {
          if (error instanceof Error && error.name === 'AbortError') return;

          console.error('Error fetching chat history:', error);

          if (
            retryCount < 2 &&
            ((error instanceof Error && 'code' in error && (error as { code?: string }).code === 'NETWORK_ERROR') ||
              !navigator.onLine)
          ) {
            setTimeout(() => loadChatHistory(page, isInitial, retryCount + 1), 1000 * (retryCount + 1));
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
          if (isInitial) setIsInitialLoading(false);
        }
      })();

      requestCache.current.set(cacheKey, loadPromise);
      loadPromise.finally(() => requestCache.current.delete(cacheKey));
      return loadPromise;
    },
    [
      showToast,
      scrollToBottom,
      mergeMessagesIntoState,
      hasLoadedLegacyHistory,
    ],
  );

  const handleJumpToMessage = useCallback(
    (starredMessage: ChatMessageFromServer) => {
      if (isJumpingRef.current) return;

      const exactMessageId = asTrimmedString(starredMessage.message_id);
      const targetTimestamp = asTrimmedString(starredMessage.timestamp);

      if (!exactMessageId && !targetTimestamp) return;

      void (async () => {
        isJumpingRef.current = true;
        suppressAutoLoadUntilRef.current = Date.now() + JUMP_SUPPRESS_AUTOLOAD_MS;
        clearToasts('conversation');
        showToast('Locating message in history...', {
          type: 'info',
          position: 'conversation',
          persist: true,
        });

        const tryJumpToDomTarget = async (targetId: string): Promise<boolean> => {
          const targetElement = await waitForMessageElement(targetId, 650);
          if (!targetElement) return false;

          clearToasts('conversation');
          targetElement.scrollIntoView({ block: 'start', behavior: 'smooth', inline: 'nearest' });
          flashJumpTarget(targetId);
          suppressAutoLoadUntilRef.current = Date.now() + JUMP_SUPPRESS_AUTOLOAD_MS;
          return true;
        };

        let didJump = false;
        let pageLoads = 0;
        let usedContextFetch = false;
        let usedTimestampFallback = false;
        let activeTargetId = exactMessageId;
        const startedAt = Date.now();

        if (!activeTargetId && targetTimestamp) {
          activeTargetId = findNearestMessageIdByTimestamp(
            targetTimestamp,
            chatMessagesRef.current,
            starredMessage.content_type,
          ) || '';
        }

        while (Date.now() - startedAt <= JUMP_MAX_WAIT_MS) {
          if (activeTargetId) {
            didJump = await tryJumpToDomTarget(activeTargetId);
            if (didJump) break;
          }

          if (!usedContextFetch && exactMessageId) {
            const response = await chatService.getMessageContextWindow(
              exactMessageId,
              36,
              36,
              targetTimestamp || undefined,
            );
            usedContextFetch = true;

            if (response.message === 'ok') {
              const windowMessages = (response.data as ChatMessageFromServer[]) || [];
              if (windowMessages.length > 0) {
                mergeMessagesIntoState(windowMessages);

                if (windowMessages.some((message) => message.message_id === exactMessageId)) {
                  activeTargetId = exactMessageId;
                } else if (targetTimestamp) {
                  const nearestId = findNearestMessageIdByTimestamp(
                    targetTimestamp,
                    windowMessages,
                    starredMessage.content_type,
                  );
                  if (nearestId) activeTargetId = nearestId;
                }

                await waitForMs(90);
                continue;
              }
            }
          }

          const state = fetchStateRef.current;
          if (state.hasMore && !state.isLoading) {
            if (pageLoads >= JUMP_MAX_PAGE_LOADS) break;

            const nextPage = Math.max(1, state.currentPage + 1);
            await loadChatHistory(nextPage, false);
            pageLoads += 1;

            if (!activeTargetId && targetTimestamp) {
              const nearestId = findNearestMessageIdByTimestamp(
                targetTimestamp,
                chatMessagesRef.current,
                starredMessage.content_type,
              );
              if (nearestId) activeTargetId = nearestId;
            }

            await waitForMs(JUMP_DOM_POLL_INTERVAL_MS);
            continue;
          }

          if (state.isLoading) {
            await waitForMs(120);
            continue;
          }

          if (!usedTimestampFallback && targetTimestamp) {
            usedTimestampFallback = true;
            const nearestId = findNearestMessageIdByTimestamp(
              targetTimestamp,
              chatMessagesRef.current,
              starredMessage.content_type,
            );
            if (nearestId && nearestId !== activeTargetId) {
              activeTargetId = nearestId;
              continue;
            }
          }

          break;
        }

        clearToasts('conversation');
        if (!didJump) {
          showToast('Unable to locate this message in the current history.', {
            type: 'error',
            position: 'conversation',
          });
        }
      })()
        .catch((error) => {
          console.error('Failed to jump to starred message context', error);
          clearToasts('conversation');
          showToast('Unable to locate this message in the current history.', {
            type: 'error',
            position: 'conversation',
          });
        })
        .finally(() => {
          isJumpingRef.current = false;
        });
    },
    [
      clearToasts,
      findNearestMessageIdByTimestamp,
      flashJumpTarget,
      loadChatHistory,
      mergeMessagesIntoState,
      showToast,
      waitForMessageElement,
    ],
  );

  const handleScrollInternal = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
      const currentFetchState = fetchStateRef.current;

      if (!showDateSticky) setShowDateSticky(true);
      if (hideDateStickyTimeoutRef.current) clearTimeout(hideDateStickyTimeoutRef.current);

      hideDateStickyTimeoutRef.current = setTimeout(() => {
        setShowDateSticky(false);
      }, 900);

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

      if (scrollTimeoutRef2.current) clearTimeout(scrollTimeoutRef2.current);

      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      const isNotAtBottom = distanceFromBottom > 100;
      setShowScrollToBottom(direction === 'up' && isNotAtBottom);

      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      setIsUserNearTop(scrollTop < SCROLL_THRESHOLD);
      const isAutoLoadSuppressed =
        isJumpingRef.current || Date.now() < suppressAutoLoadUntilRef.current;

      if (
        !isAutoLoadSuppressed &&
        scrollTop < SCROLL_THRESHOLD &&
        currentFetchState.hasMore &&
        !currentFetchState.isLoading &&
        !isInitialLoading
      ) {
        scrollTimeoutRef.current = setTimeout(() => {
          const nextPage = Math.max(1, fetchStateRef.current.currentPage + 1);
          loadChatHistory(nextPage, false);
        }, FETCH_DEBOUNCE_MS);
      }
    },
    [
      isInitialLoading,
      loadChatHistory,
      showDateSticky,
    ],
  );

  const handleScroll = useMemo(() => throttle(handleScrollInternal, SCROLL_THROTTLE_MS), [handleScrollInternal]);

  const handleResize = useCallback(() => {
    setDynamicMaxHeight(window.innerHeight / DYNAMIC_MAX_HEIGHT_RATIO);
    calculateMinHeight();
  }, [calculateMinHeight]);

  const debouncedHandleResize = useMemo(() => debounce(handleResize, RESIZE_DEBOUNCE_MS), [handleResize]);

  const clearAllInput = useCallback(() => {
    setMessage('');
    setInputValue('');
    setCurrentAttachments([]);
    attachmentInputAreaRef.current?.clear();
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
        const isScrolledToBottom = textarea.scrollTop + textarea.clientHeight >= textarea.scrollHeight - 1;
        const isCursorAtEnd = cursorPosition === textarea.value.length;

        const shouldAutoScroll = !shouldPreserveCursor || isScrolledToBottom || isCursorAtEnd;

        textarea.style.height = 'auto';
        const scrollHeight = textarea.scrollHeight;
        const newHeight = Math.min(scrollHeight, dynamicMaxHeight);
        textarea.style.height = `${newHeight}px`;

        if (scrollHeight > dynamicMaxHeight) {
          textarea.scrollTop = shouldAutoScroll ? textarea.scrollHeight : currentScrollTop;
        }

        if (shouldPreserveCursor) textarea.setSelectionRange(cursorPosition, selectionEnd);
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

  const { executeSubmission, handleRetryMessage, getMostRecentAssistantMessageId } = useMessageSubmission({
    message,
    currentAttachments,
    chatMessages,
    isSearchActive,
    isSending,
    setIsSending,
    setCurrentThoughtText,
    lastOptimisticMessageIdRef,
    setChatMessages,
    setIsAssistantTyping,
    clearAllInput,
    scrollToBottom,
    onMessageSent: () => {
      setTimeout(() => calculateMinHeight(), 200);
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
      const heightDifference = scrollContainer.scrollHeight - previousScrollHeight.current;

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
      inputRef.current?.focus({ preventScroll: true });
      initialLoadDone.current = true;
    }
  }, [loadChatHistory]);

  useEffect(() => {
    let isMounted = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const hydrateStarred = async (attempt: number = 0) => {
      const result = await loadPersistedStarredMessages(false);
      if (!isMounted) return;

      if (result === 'unauthorized' && attempt < 6) {
        retryTimer = setTimeout(() => {
          void hydrateStarred(attempt + 1);
        }, 250 * (attempt + 1));
      }
    };

    void hydrateStarred();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        void hydrateStarred();
      } else if (event === 'SIGNED_OUT') {
        setStarredMessageIds([]);
        setStarredMessageSnapshots([]);
      }
    });

    return () => {
      isMounted = false;
      if (retryTimer) clearTimeout(retryTimer);
      subscription.unsubscribe();
    };
  }, [loadPersistedStarredMessages]);

  useEffect(() => {
    if (!supabaseUserId) return;

    const messagesChannel = supabase
      .channel(`conversation-messages:${supabaseUserId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `user_id=eq.${supabaseUserId}`,
        },
        (payload) => {
          const mapped = mapRealtimeMessageRow(payload.new);
          if (!mapped) return;
          mergeMessagesIntoState([mapped]);
          mergeGalleryItems(extractGalleryImagesFromMessages([mapped]));
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `user_id=eq.${supabaseUserId}`,
        },
        (payload) => {
          const mapped = mapRealtimeMessageRow(payload.new);
          if (!mapped) return;
          mergeMessagesIntoState([mapped]);
          mergeGalleryItems(extractGalleryImagesFromMessages([mapped]));
        },
      )
      .subscribe();

    const starredChannel = supabase
      .channel(`conversation-stars:${supabaseUserId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'starred_messages',
          filter: `user_id=eq.${supabaseUserId}`,
        },
        (payload) => {
          const mapped = mapRealtimeStarredRow(payload.new);
          if (!mapped) return;
          setStarredMessageIds((prev) =>
            prependUniqueId(removeId(prev, mapped.message_id), mapped.message_id),
          );
          setStarredMessageSnapshots((prev) => upsertSnapshot(prev, mapped));
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'starred_messages',
          filter: `user_id=eq.${supabaseUserId}`,
        },
        (payload) => {
          const mapped = mapRealtimeStarredRow(payload.new);
          if (!mapped) return;
          setStarredMessageIds((prev) =>
            prependUniqueId(removeId(prev, mapped.message_id), mapped.message_id),
          );
          setStarredMessageSnapshots((prev) => upsertSnapshot(prev, mapped));
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'starred_messages',
          filter: `user_id=eq.${supabaseUserId}`,
        },
        (payload) => {
          const oldRow = payload.old as { message_id?: unknown } | null;
          const messageId = typeof oldRow?.message_id === 'string' ? oldRow.message_id : '';
          if (!messageId) return;

          setStarredMessageIds((prev) => removeId(prev, messageId));
          setStarredMessageSnapshots((prev) => removeSnapshot(prev, messageId));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(messagesChannel);
      supabase.removeChannel(starredChannel);
    };
  }, [mergeGalleryItems, mergeMessagesIntoState, supabaseUserId]);

  useEffect(() => {
    if (justSentMessageRef.current) {
      scrollToBottom(true, true);
      justSentMessageRef.current = false;
    }
  }, [chatMessages, scrollToBottom]);

  useEffect(() => {
    handleResize();
    window.addEventListener('resize', debouncedHandleResize);
    const cleanup = () => window.removeEventListener('resize', debouncedHandleResize);
    cleanupFunctions.current.push(cleanup);
    return cleanup;
  }, [handleResize, debouncedHandleResize]);

  useEffect(() => {
    return () => {
      currentAttachments.forEach((att) => att.previewUrl && URL.revokeObjectURL(att.previewUrl));
    };
  }, [currentAttachments]);

  useEffect(() => {
    return () => {
      fetchState.abortController?.abort();

      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      if (scrollTimeoutRef2.current) clearTimeout(scrollTimeoutRef2.current);
      if (hideDateStickyTimeoutRef.current) clearTimeout(hideDateStickyTimeoutRef.current);
      if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);

      cleanupFunctions.current.forEach((cleanup) => cleanup());
      cleanupFunctions.current = [];
      requestCache.current.clear();

      currentAttachments.forEach((att) => att.previewUrl && URL.revokeObjectURL(att.previewUrl));
    };
  }, [fetchState.abortController, currentAttachments]);

  const handleScrollToBottomClick = useCallback(() => {
    scrollToBottom(true, true);
  }, [scrollToBottom]);

  const handleFormSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!canSubmit) return;
      justSentMessageRef.current = true;
      executeSubmission(message, currentAttachments);
    },
    [
      executeSubmission,
      message,
      currentAttachments,
      canSubmit,
    ],
  );

  const handleOpenSettings = useCallback(() => {
    setShowSupportPanel(true);
  }, []);

  const handleOpenUpgrade = useCallback(() => {
    openModal('upgrade_button', true);
  }, [openModal]);

  const handleSignOut = useCallback(async () => {
    try {
      localStorage.clear();
      await supabase.auth.signOut();
      window.location.href = '/sign-in';
    } catch (error) {
      console.error('Failed to sign out:', error);
      showToast('Failed to sign out. Please try again.', {
        type: 'error',
        position: 'conversation',
      });
    }
  }, [showToast]);

  const supabaseMetadata = (supabaseUser?.user_metadata ?? {}) as Record<string, unknown>;
  const profileName = firstNonEmpty(
    supabaseMetadata.full_name,
    supabaseMetadata.name,
    sessionData?.user?.name,
    supabaseUser?.email,
    sessionData?.user?.email,
  );
  const profileEmail = firstNonEmpty(supabaseUser?.email, sessionData?.user?.email);
  const profileImage = firstNonEmpty(
    supabaseMetadata.avatar_url,
    sessionData?.user?.image,
  ) || null;

  const handleOpenVoiceAssistant = useCallback(() => {
    setShowMeeraVoice(true);
  }, []);

  const handleCloseSupportPanel = useCallback(() => {
    setShowSupportPanel(false);
  }, []);

  const handleToggleDesktopSidebar = useCallback(() => {
    setIsSidebarVisible((prev) => !prev);
  }, []);

  const handleOpenMobileSidebar = useCallback(() => {
    setIsMobileSidebarOpen(true);
  }, []);

  const desktopSidebarMarginClass = useMemo(() => {
    if (!isSidebarVisible) return 'md:ml-0';
    return 'md:ml-[260px]';
  }, [isSidebarVisible]);
  const isImagesView = activeSidebarView === 'images';

  return (
    <div className="relative bg-background overflow-x-hidden">
      <Sidebar
        isVisible={isSidebarVisible}
        isMobileOpen={isMobileSidebarOpen}
        tokensConsumed={formattedTotalCostTokens}
        starredMessages={starredMessages}
        onJumpToMessage={handleJumpToMessage}
        activeView={activeSidebarView}
        onSelectView={handleSelectSidebarView}
        userName={profileName}
        userEmail={profileEmail}
        userAvatar={profileImage}
        onToggleSidebar={handleToggleDesktopSidebar}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
        onUpgrade={handleOpenUpgrade}
        onOpenSettings={handleOpenSettings}
        onSignOut={handleSignOut}
        subscriptionData={subscriptionData}
        isSubscriptionLoading={isSubscriptionLoading}
      />

      <div
        className={`grid grid-rows-[auto_1fr_auto] h-[100dvh] min-h-0 overflow-hidden bg-background relative transition-[margin] duration-200 ${desktopSidebarMarginClass}`}
      >
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
          style={{ paddingTop: 'calc(env(safe-area-inset-top) + 1rem)' }}
        >
          <div className="w-full mx-auto flex items-center justify-between">
            <button
              onClick={handleOpenMobileSidebar}
              className="md:hidden flex items-center justify-center w-9 h-9 rounded-full border-2 border-primary/20 hover:border-primary/50 transition-colors text-primary"
              aria-label="Open sidebar"
              title="Open sidebar"
            >
              <FiMenu size={18} className="text-primary" />
            </button>

            {!isSidebarVisible ? (
              <button
                onClick={handleToggleDesktopSidebar}
                className="hidden md:flex items-center justify-center w-9 h-9 rounded-full border-2 border-primary/20 hover:border-primary/50 transition-colors text-primary"
                aria-label="Open sidebar"
                title="Open sidebar"
              >
                <FiMenu size={18} className="text-primary" />
              </button>
            ) : (
              <div className="w-9 h-9 hidden md:block" />
            )}

            <div className="absolute left-1/2 transform -translate-x-1/2 flex items-center">
              <h1 className="text-lg text-primary md:text-xl font-sans">
                {isImagesView ? 'My images' : process.env.NEXT_PUBLIC_APP_NAME}
              </h1>
            </div>

            {isImagesView ? (
              <div className="w-9 h-9" />
            ) : (
              <button
                onClick={handleOpenVoiceAssistant}
                className="flex items-center justify-center w-9 p-2 h-9 rounded-full border-2 border-primary/20 hover:border-primary/50 transition-colors text-primary"
                aria-label="Open voice assistant"
              >
                <IoCallSharp size={24} className="text-primary" />
              </button>
            )}
          </div>
        </header>

        <main
          ref={mainScrollRef}
          className="min-h-0 overflow-y-auto overflow-x-hidden w-full scroll-pt-2.5"
          onScroll={isImagesView ? undefined : handleScroll}
        >
          <div
            className={
              isImagesView
                ? 'px-2 sm:px-0 py-6 w-full min-w-0 max-w-full sm:max-w-5xl xl:max-w-6xl mx-auto'
                : 'px-2 sm:px-0 py-6 w-full min-w-0 max-w-full sm:max-w-2xl md:max-w-3xl mx-auto'
            }
          >
            {isImagesView ? (
              <div className="w-full max-w-6xl mx-auto">
                <ImagesView
                  images={galleryImages}
                  isLoading={isGalleryLoading}
                  hasMore={galleryHasMore}
                  onLoadMore={handleLoadMoreImages}
                />
              </div>
            ) : (
              <>
            {isInitialLoading && (
              <div className="flex justify-center items-center h-[calc(100vh-15rem)]">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
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
              <div className="h-[calc(100vh-10rem)]" />
            )}

            {!isInitialLoading && chatMessages.length > 0 && (
              <div className="flex flex-col space-y-0 w-full min-w-0">
                {fetchState.isLoading && isUserNearTop && (
                  <div className="flex justify-center py-4 sticky top-0 z-10">
                    <div className="bg-background/80 backdrop-blur-sm rounded-full p-2 shadow-sm border border-primary/10">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary" />
                    </div>
                  </div>
                )}

                {messagesByDate.map(([dateKey, messages]) => {
                  const dateHeader = formatWhatsAppStyle(dateKey);

                  return (
                    <div key={dateKey} className="date-group relative w-full min-w-0">
                      {dateHeader && showDateSticky && (
                        <div className="sticky pt-2 z-20 flex justify-center my-3 top-0 pointer-events-none">
                          <div className="bg-background text-primary text-xs px-4 py-1.5 rounded-full shadow-sm border border-primary/10">
                            {dateHeader}
                          </div>
                        </div>
                      )}

                      <div className="messages-container min-w-0">
                        {messages.map((item) => {
                          if (item.type === 'call_session') {
                            const isHighlightedCallSession = item.messages.some(
                              (message) => message.message_id === highlightedMessageId,
                            );

                            return (
                              <div
                                key={item.id}
                                className="relative"
                                style={
                                  isHighlightedCallSession
                                    ? {
                                        backgroundColor: 'color-mix(in oklab, var(--primary) 12%, transparent)',
                                        boxShadow: '0 0 0 1px color-mix(in oklab, var(--primary) 30%, transparent)',
                                        borderRadius: '12px',
                                        transition: 'background-color 240ms ease, box-shadow 240ms ease',
                                      }
                                    : undefined
                                }
                              >
                                {item.messages.map((message) => (
                                  <span
                                    key={message.message_id}
                                    id={`message-${message.message_id}`}
                                    className="absolute left-0 top-0 h-px w-px opacity-0 pointer-events-none"
                                    aria-hidden="true"
                                  />
                                ))}
                                <MemoizedCallSessionItem messages={item.messages} />
                              </div>
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
                          const effectiveThoughtText = currentThoughtText || storedThoughts || undefined;

                          const shouldShowTypingIndicator =
                            msg.content_type === 'assistant' &&
                            msg.message_id === lastMessage?.message_id &&
                            isAssistantTyping &&
                            (msg.content ?? '').length === 0;

                          const isLatestUserMessage =
                            msg.content_type === 'user' && msg.message_id === lastOptimisticMessageIdRef.current;

                          const isLatestAssistantMessage =
                            msg.content_type === 'assistant' && msg.message_id === getMostRecentAssistantMessageId();

                          return (
                            <div
                              id={`message-${msg.message_id}`}
                              data-content-type={msg.content_type}
                              key={msg.message_id}
                              ref={
                                isLatestUserMessage
                                  ? latestUserMessageRef
                                  : isLatestAssistantMessage
                                    ? latestAssistantMessageRef
                                    : null
                              }
                              className="message-item-wrapper w-full min-w-0 transform-gpu will-change-transform"
                              style={
                                highlightedMessageId === msg.message_id
                                  ? {
                                      backgroundColor: 'color-mix(in oklab, var(--primary) 12%, transparent)',
                                      boxShadow: '0 0 0 1px color-mix(in oklab, var(--primary) 30%, transparent)',
                                      borderRadius: '12px',
                                      transition: 'background-color 240ms ease, box-shadow 240ms ease',
                                    }
                                  : undefined
                              }
                            >
                              <MemoizedRenderedMessageItem
                                message={msg}
                                isStreaming={isStreamingMessage}
                                onRetry={handleRetryMessage}
                                onToggleStar={toggleStarForMessage}
                                isStarred={starredMessageIdSet.has(msg.message_id)}
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
              </>
            )}
          </div>
        </main>

        {isImagesView ? (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-40">
            <Toast position="conversation" />
          </div>
        ) : null}

        {!isImagesView ? (
        <footer
          ref={footerRef}
          className="w-full z-40 p-2 md:pr-[13px] bg-transparent"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.5rem)' }}
        >
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
                        onClick={() => openModal('subscription_has_ended_renew_here_toast_clicked', true)}
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
                  <div className="w-fit mx-auto px-4 py-2 rounded-md border bg-[#E7E5DA]/80 backdrop-blur-sm shadow-md text-dark break-words border-primary">
                    <span className="text-sm">You have {subscriptionData?.tokens_left} tokens left. </span>
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
                  className="p-2 rounded-full bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 transition-all duration-200 hover:scale-105 shadow-md backdrop-blur-sm hidden"
                  title="Scroll to bottom"
                >
                  <MdKeyboardArrowDown size={20} />
                </button>
              )}

              <div className="w-full pt-1 flex justify_center">
                <Toast position="conversation" />
              </div>
            </div>

            <form onSubmit={handleFormSubmit} className="w-full max-w-3xl mx-auto bg-transparent mt-[-25px]">
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
                      if (!canSubmit) return;
                      const form = e.currentTarget.form;
                      if (form && typeof form.requestSubmit === 'function') {
                        form.requestSubmit();
                      } else {
                        handleFormSubmit(e as unknown as React.FormEvent<HTMLFormElement>);
                      }
                    }
                  }}
                  onPaste={handlePaste}
                />

                <div className="flex flex-row items-center justify-between px-3 pb-1.5">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={stableCallbacks.toggleSearchActive}
                      className={`py-2 px-3 rounded-2xl flex items-center justify-center gap-2 border border-primary/20 focus:outline-none transition-all duration-150 ease-in-out text-sm font-medium cursor-pointer transform-gpu will-change-transform ${
                        isSearchActive ? 'bg-primary/10 text-primary' : 'text-gray-500 hover:bg-gray-50'
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
                      onUploadStateChange={setIsUploadingAttachments}
                    >
                      <FiPaperclip size={18} />
                    </AttachmentInputArea>

                    <button
                      type="submit"
                      className={`rounded-full flex items-center justify-center focus:outline-none transition-all duration-150 ease-in-out cursor-pointer min-w-[38px] min-h-[38px] transform-gpu will-change-transform ${
                        canSubmit
                          ? 'bg-primary text-background hover:bg-primary/90 hover:scale-105'
                          : 'bg-primary/20 text-primary/50 cursor-not-allowed'
                      }`}
                      disabled={!canSubmit}
                      title={hasPendingUploads ? 'Uploading attachment…' : 'Send message'}
                    >
                      <FiArrowUp size={20} />
                    </button>
                  </div>
                </div>
              </div>
            </form>
          </div>
        </footer>
        ) : null}

        <SupportPanel isOpen={showSupportPanel} onClose={handleCloseSupportPanel} />
        <MeeraVoice
          isOpen={showMeeraVoice}
          onClose={(wasConnected) => {
            setShowMeeraVoice(false);
            if (wasConnected) loadChatHistory(1, true);
          }}
        />
      </div>
    </div>
  );
};

export default Conversation;
