'use client';

import { ChatMessageFromServer } from '@/types/chat';
import Image from 'next/image';
import React, { useCallback, useMemo, useState } from 'react';
import { TbLayoutSidebarLeftCollapse } from 'react-icons/tb';
import { ProfileMenu } from './ProfileMenu';
import { SidebarItem } from './Sidebar/SidebarItem';

interface SidebarProps {
  isVisible: boolean;
  tokensLeft?: number | null;
  starredMessages: ChatMessageFromServer[];
  onJumpToMessage: (messageId: string) => void;
  userName: string;
  userEmail: string;
  userAvatar?: string | null;
  onToggleSidebar: () => void;
  onUpgrade: () => void;
  onOpenSettings: () => void;
  onSignOut: () => void;
}

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
  onJumpToMessage,
  userName,
  userEmail,
  userAvatar,
  onToggleSidebar,
  onUpgrade,
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
      onJumpToMessage(messageId);
    },
    [onJumpToMessage],
  );

  const handleOpenSettings = useCallback(() => {
    setIsProfileOpen(false);
    onOpenSettings();
  }, [onOpenSettings]);

  const handleUpgrade = useCallback(() => {
    setIsProfileOpen(false);
    onUpgrade();
  }, [onUpgrade]);

  const handleSignOut = useCallback(() => {
    setIsProfileOpen(false);
    onSignOut();
  }, [onSignOut]);

  if (!isVisible) return null;

  return (
    <>
      <aside className="hidden md:flex fixed left-0 top-0 h-screen z-40 bg-background border-r border-primary/15 flex-col w-[260px]">
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

        <div className="px-3 py-2.5 border-t border-primary/15">
          <button
            type="button"
            onClick={() => setIsProfileOpen((prev) => !prev)}
            className="w-full flex items-center rounded-xl px-2 py-1.5 hover:bg-primary/10 transition-colors cursor-pointer gap-2.5"
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
            <div className="min-w-0 text-left">
              <p className="text-sm text-primary truncate">{displayName}</p>
              {displayEmail ? <p className="text-xs text-primary/60 truncate">{displayEmail}</p> : null}
            </div>
          </button>
        </div>
      </aside>

      <ProfileMenu
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
        tokensLeft={tokensLeft}
        onUpgrade={handleUpgrade}
        onOpenSettings={handleOpenSettings}
        onSignOut={handleSignOut}
        anchor="sidebar-bottom"
      />
    </>
  );
};
