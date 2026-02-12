'use client';

import { ChatMessageFromServer } from '@/types/chat';
import Image from 'next/image';
import React, { useCallback, useMemo, useState } from 'react';
import { TbLayoutSidebarLeftCollapse } from 'react-icons/tb';
import { ProfileMenu } from './ProfileMenu';

interface SidebarProps {
  isVisible: boolean;
  tokensLeft?: number | null;
  starredMessages: ChatMessageFromServer[];
  onSelectStarredMessage: (messageId: string) => void;
  userName: string;
  userEmail: string;
  userAvatar?: string | null;
  onToggleSidebar: () => void;
  onOpenSettings: () => void;
  onSignOut: () => void;
}

const truncatePreview = (content: string): string => {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) return 'Untitled message';
  if (normalized.length <= 42) return normalized;
  return `${normalized.slice(0, 42)}...`;
};

const getTimeValue = (timestamp: string): number => {
  const parsed = new Date(timestamp).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

const getGroupLabel = (timestamp: string, now: Date): string => {
  const ts = new Date(timestamp);
  if (Number.isNaN(ts.getTime())) return 'Older';

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
  tokensLeft,
  starredMessages,
  onSelectStarredMessage,
  userName,
  userEmail,
  userAvatar,
  onToggleSidebar,
  onOpenSettings,
  onSignOut,
}) => {
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  const displayName = userName.trim() || 'Profile';
  const displayEmail = userEmail.trim() || '';
  const profileInitial = displayName.charAt(0).toUpperCase() || 'P';

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
      onSelectStarredMessage(messageId);
    },
    [onSelectStarredMessage],
  );

  const handleOpenSettings = useCallback(() => {
    setIsProfileOpen(false);
    onOpenSettings();
  }, [onOpenSettings]);

  const handleSignOut = useCallback(() => {
    setIsProfileOpen(false);
    onSignOut();
  }, [onSignOut]);

  if (!isVisible) return null;

  return (
    <>
      <aside className="hidden md:flex fixed left-0 top-0 h-screen z-40 bg-background border-r border-primary/15 flex-col w-[260px]">
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-4 h-4 rounded-full bg-primary flex-shrink-0" />
              <span className="text-primary text-[16px] leading-none font-serif italic truncate">
                {(process.env.NEXT_PUBLIC_APP_NAME || 'meera').toLowerCase()} os
              </span>
            </div>

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
                      <button
                        key={message.message_id}
                        type="button"
                        onClick={() => handleSelectStarredMessage(message.message_id)}
                        className="w-full rounded-lg px-2 py-2 text-left text-[15px] text-primary/90 hover:bg-primary/5 transition-colors truncate"
                        title={message.content}
                      >
                        {truncatePreview(message.content)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-primary/15">
          <button
            type="button"
            onClick={() => setIsProfileOpen((prev) => !prev)}
            className="w-full flex items-center rounded-xl px-2.5 py-2 hover:bg-primary/10 transition-colors cursor-pointer gap-3"
            aria-label="Open profile menu"
          >
            {userAvatar ? (
              <Image
                src={userAvatar}
                alt={displayName}
                width={36}
                height={36}
                className="w-9 h-9 rounded-full object-cover border border-primary/20"
              />
            ) : (
              <span className="w-9 h-9 rounded-full border border-primary/20 bg-primary/10 text-primary text-sm font-medium flex items-center justify-center">
                {profileInitial}
              </span>
            )}
            <div className="min-w-0 text-left">
              <p className="text-sm text-primary truncate">{displayName}</p>
              <p className="text-xs text-primary/60 truncate">{displayEmail || 'Profile'}</p>
            </div>
          </button>
        </div>
      </aside>

      <ProfileMenu
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
        userName={displayName}
        userEmail={displayEmail}
        userAvatar={userAvatar}
        tokensLeft={tokensLeft}
        starredMessages={starredMessages}
        onSelectStarredMessage={handleSelectStarredMessage}
        onOpenSettings={handleOpenSettings}
        onSignOut={handleSignOut}
        anchor="sidebar-bottom"
      />
    </>
  );
};
