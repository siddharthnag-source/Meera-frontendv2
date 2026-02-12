'use client';

import { ChatMessageFromServer } from '@/types/chat';
import Image from 'next/image';
import React, { useCallback, useState } from 'react';
import { FiPlus } from 'react-icons/fi';
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
      <aside className="hidden md:flex fixed left-0 top-0 h-screen z-40 bg-primary border-r border-background/20 flex-col w-[260px]">
        <div className="p-4 border-b border-background/20">
          <div className="flex items-center justify-between mb-3">
            <div className="text-background text-base font-semibold truncate">
              {process.env.NEXT_PUBLIC_APP_NAME || 'Meera'}
            </div>

            <button
              type="button"
              onClick={onToggleSidebar}
              className="w-7 h-7 rounded-md text-background/80 hover:text-background hover:bg-background/10 transition-colors flex items-center justify-center"
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
            >
              <TbLayoutSidebarLeftCollapse size={17} />
            </button>
          </div>

          <button
            type="button"
            className="w-full rounded-xl border border-background/20 bg-background/10 py-2 text-sm text-background hover:bg-background/20 transition-colors flex items-center px-3 justify-start gap-2"
          >
            <FiPlus size={15} />
            <span>New chat</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <p className="text-background/60 text-sm">Chat history coming soon.</p>
        </div>

        <div className="p-4 border-t border-background/20">
          <button
            type="button"
            onClick={() => setIsProfileOpen((prev) => !prev)}
            className="w-full flex items-center rounded-xl px-2.5 py-2 hover:bg-background/10 transition-colors cursor-pointer gap-3"
            aria-label="Open profile menu"
          >
            {userAvatar ? (
              <Image
                src={userAvatar}
                alt={displayName}
                width={36}
                height={36}
                className="w-9 h-9 rounded-full object-cover border border-background/30"
              />
            ) : (
              <span className="w-9 h-9 rounded-full border border-background/30 bg-background/10 text-background text-sm font-medium flex items-center justify-center">
                {profileInitial}
              </span>
            )}
            <div className="min-w-0 text-left">
              <p className="text-sm text-background truncate">{displayName}</p>
              <p className="text-xs text-background/70 truncate">{displayEmail || 'Profile'}</p>
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
