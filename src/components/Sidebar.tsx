'use client';

import { ChatMessageFromServer } from '@/types/chat';
import Image from 'next/image';
import React, { useCallback, useMemo, useState } from 'react';
import { FiImage } from 'react-icons/fi';
import { TbLayoutSidebarLeftCollapse } from 'react-icons/tb';
import { parseTimestamp } from '@/lib/dateUtils';
import { PWAInstallEntry } from './PWAInstallEntry';
import { ProfileMenu } from './ProfileMenu';
import { SidebarItem } from './Sidebar/SidebarItem';

type SidebarView = 'chat' | 'images';

interface SidebarProps {
  isVisible: boolean;
  isMobileOpen: boolean;
  tokensConsumed?: string | null;
  starredMessages: ChatMessageFromServer[];
  onJumpToMessage: (messageId: string) => void;
  activeView: SidebarView;
  onSelectView: (view: SidebarView) => void;
  userName: string;
  userEmail: string;
  userAvatar?: string | null;
  onToggleSidebar: () => void;
  onCloseMobile: () => void;
  onUpgrade: () => void;
  onOpenSettings: () => void;
  onSignOut: () => void;
}

const getTimeValue = (timestamp: string): number => {
  const parsed = new Date(timestamp).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

const getGroupLabel = (timestamp: string, now: Date): string => {
  const ts = parseTimestamp(timestamp);
  if (!ts) return 'Older';

  const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const tsDay = new Date(ts.getFullYear(), ts.getMonth(), ts.getDate()).getTime();
  const dayDiff = Math.floor((nowDay - tsDay) / 86400000);

  if (dayDiff <= 0) return 'Today';
  if (dayDiff === 1) return 'Yesterday';
  if (dayDiff <= 30) return '30 days';

  return ts.toLocaleString(undefined, { month: 'short', year: 'numeric' });
};

export const Sidebar: React.FC<SidebarProps> = ({
  isVisible,
  isMobileOpen,
  tokensConsumed,
  starredMessages,
  onJumpToMessage,
  activeView,
  onSelectView,
  userName,
  userEmail,
  userAvatar,
  onToggleSidebar,
  onCloseMobile,
  onUpgrade,
  onOpenSettings,
  onSignOut,
}) => {
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  const normalizedName = userName.trim();
  const normalizedEmail = userEmail.trim();
  const displayName = normalizedName || normalizedEmail;
  const displayEmail = normalizedName ? normalizedEmail : '';
  const profileInitial = displayName.charAt(0).toUpperCase() || 'U';

  const starredGroups = useMemo(() => {
    const now = new Date();
    const sorted = [...starredMessages].sort((a, b) => getTimeValue(b.timestamp) - getTimeValue(a.timestamp));

    const groups = new Map<string, ChatMessageFromServer[]>();
    sorted.forEach((message) => {
      const label = getGroupLabel(message.timestamp, now);
      const entries = groups.get(label) || [];
      entries.push(message);
      groups.set(label, entries);
    });

    return Array.from(groups.entries());
  }, [starredMessages]);

  const handleSelectStarredMessage = useCallback(
    (messageId: string) => {
      setIsProfileOpen(false);
      onSelectView('chat');
      if (isMobileOpen) onCloseMobile();
      onJumpToMessage(messageId);
    },
    [isMobileOpen, onCloseMobile, onJumpToMessage, onSelectView],
  );

  const handleToggleImagesView = useCallback(() => {
    onSelectView(activeView === 'images' ? 'chat' : 'images');
    if (isMobileOpen) onCloseMobile();
  }, [activeView, isMobileOpen, onCloseMobile, onSelectView]);

  const handleOpenSettings = useCallback(() => {
    setIsProfileOpen(false);
    if (isMobileOpen) onCloseMobile();
    onOpenSettings();
  }, [isMobileOpen, onCloseMobile, onOpenSettings]);

  const handleUpgrade = useCallback(() => {
    setIsProfileOpen(false);
    if (isMobileOpen) onCloseMobile();
    onUpgrade();
  }, [isMobileOpen, onCloseMobile, onUpgrade]);

  const handleSignOut = useCallback(() => {
    setIsProfileOpen(false);
    if (isMobileOpen) onCloseMobile();
    onSignOut();
  }, [isMobileOpen, onCloseMobile, onSignOut]);

  if (!isVisible && !isMobileOpen) return null;

  return (
    <>
      <aside className={`${isVisible ? 'hidden md:flex' : 'hidden'} fixed left-0 top-0 h-screen z-40 bg-background border-r border-primary/15 flex-col w-[260px]`}>
        <div className="px-4 pt-3 pb-1">
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={onToggleSidebar}
              className="w-7 h-7 rounded-md text-primary/80 hover:text-primary hover:bg-primary/10 transition-colors flex items-center justify-center"
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
            >
              <TbLayoutSidebarLeftCollapse size={17} />
            </button>
          </div>

          <button
            type="button"
            onClick={handleToggleImagesView}
            className={`mt-2 w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-[15px] font-semibold transition-colors ${
              activeView === 'images'
                ? 'bg-primary/10 text-primary'
                : 'text-primary hover:bg-primary/10'
            }`}
            aria-label="Open images"
          >
            <FiImage size={17} />
            <span>Images</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {starredGroups.length === 0 ? (
            <p className="text-primary/55 text-sm px-2">No starred messages</p>
          ) : (
            <div className="space-y-5">
              {starredGroups.map(([label, messages]) => (
                <div key={label}>
                  <p className="text-xs font-medium text-primary/45 mb-2 px-2">{label}</p>
                  <div className="space-y-1">
                    {messages.map((message) => (
                      <SidebarItem
                        key={message.message_id}
                        message={message}
                        onSelect={handleSelectStarredMessage}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-3 py-2 border-t border-primary/15">
          <button
            type="button"
            onClick={() => setIsProfileOpen((prev) => !prev)}
            className="w-full flex items-center rounded-xl px-2 py-1 hover:bg-primary/10 transition-colors cursor-pointer gap-2"
            aria-label="Open profile menu"
          >
            {userAvatar ? (
              <Image
                src={userAvatar}
                alt={displayName}
                width={32}
                height={32}
                className="w-8 h-8 rounded-full object-cover border border-primary/20"
              />
            ) : (
              <span className="w-8 h-8 rounded-full border border-primary/20 bg-primary/10 text-primary text-sm font-medium flex items-center justify-center">
                {profileInitial}
              </span>
            )}
            <div className="min-w-0 text-left leading-tight">
              <p className="text-sm text-primary truncate">{displayName}</p>
              {displayEmail ? <p className="text-xs text-primary/60 truncate">{displayEmail}</p> : null}
            </div>
          </button>
        </div>
      </aside>

      {isMobileOpen ? (
        <div className="md:hidden fixed inset-0 z-50">
          <button
            type="button"
            onClick={onCloseMobile}
            className="absolute inset-0 bg-black/25"
            aria-label="Close sidebar backdrop"
          />

          <aside
            className="absolute left-0 top-0 h-[100dvh] max-h-[100dvh] w-[84vw] max-w-[320px] bg-background border-r border-primary/15 flex flex-col shadow-xl"
            style={{
              paddingTop: 'env(safe-area-inset-top)',
              paddingBottom: 'env(safe-area-inset-bottom)',
            }}
          >
            <div className="px-4 pt-3 pb-1">
              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={onCloseMobile}
                  className="w-7 h-7 rounded-md text-primary/80 hover:text-primary hover:bg-primary/10 transition-colors flex items-center justify-center"
                  aria-label="Close sidebar"
                  title="Close sidebar"
                >
                  <TbLayoutSidebarLeftCollapse size={17} />
                </button>
              </div>

              <PWAInstallEntry />

              <button
                type="button"
                onClick={handleToggleImagesView}
                className={`mt-2 w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-[15px] font-semibold transition-colors ${
                  activeView === 'images'
                    ? 'bg-primary/10 text-primary'
                    : 'text-primary hover:bg-primary/10'
                }`}
                aria-label="Open images"
              >
                <FiImage size={17} />
                <span>Images</span>
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-4">
              {starredGroups.length === 0 ? (
                <p className="text-primary/55 text-sm px-2">No starred messages</p>
              ) : (
                <div className="space-y-5">
                  {starredGroups.map(([label, messages]) => (
                    <div key={label}>
                      <p className="text-xs font-medium text-primary/45 mb-2 px-2">{label}</p>
                      <div className="space-y-1">
                        {messages.map((message) => (
                          <SidebarItem
                            key={message.message_id}
                            message={message}
                            onSelect={handleSelectStarredMessage}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="px-3 py-2 border-t border-primary/15 shrink-0">
              <button
                type="button"
                onClick={() => setIsProfileOpen((prev) => !prev)}
                className="w-full flex items-center rounded-xl px-2 py-1 hover:bg-primary/10 transition-colors cursor-pointer gap-2"
                aria-label="Open profile menu"
              >
                {userAvatar ? (
                  <Image
                    src={userAvatar}
                    alt={displayName}
                    width={32}
                    height={32}
                    className="w-8 h-8 rounded-full object-cover border border-primary/20"
                  />
                ) : (
                  <span className="w-8 h-8 rounded-full border border-primary/20 bg-primary/10 text-primary text-sm font-medium flex items-center justify-center">
                    {profileInitial}
                  </span>
                )}
                <div className="min-w-0 text-left leading-tight">
                  <p className="text-sm text-primary truncate">{displayName}</p>
                  {displayEmail ? <p className="text-xs text-primary/60 truncate">{displayEmail}</p> : null}
                </div>
              </button>
            </div>
          </aside>
        </div>
      ) : null}

      <ProfileMenu
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
        tokensConsumed={tokensConsumed}
        onUpgrade={handleUpgrade}
        onOpenSettings={handleOpenSettings}
        onSignOut={handleSignOut}
        anchor="sidebar-bottom"
      />
    </>
  );
};
