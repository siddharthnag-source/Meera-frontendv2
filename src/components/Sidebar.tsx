'use client';

import { ChatMessageFromServer } from '@/types/chat';
import Image from 'next/image';
import React, { useCallback, useState } from 'react';
import { ProfileMenu } from './ProfileMenu';

interface SidebarProps {
  tokensLeft?: number | null;
  starredMessages: ChatMessageFromServer[];
  onSelectStarredMessage: (messageId: string) => void;
  userName: string;
  userEmail: string;
  userAvatar?: string | null;
  onOpenSettings: () => void;
  onSignOut: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  tokensLeft,
  starredMessages,
  onSelectStarredMessage,
  userName,
  userEmail,
  userAvatar,
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

  return (
    <>
      <aside className="hidden md:flex fixed left-0 top-0 h-screen w-[260px] z-40 bg-black border-r border-white/20 flex-col">
        <div className="p-4 border-b border-white/20">
          <div className="text-white text-base font-semibold mb-3">{process.env.NEXT_PUBLIC_APP_NAME || 'Meera'}</div>
          <button
            type="button"
            className="w-full rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-sm text-white hover:bg-white/10 transition-colors"
          >
            + New chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <p className="text-sm text-white/50">Chat history coming soon.</p>
        </div>

        <div className="p-4 border-t border-white/20">
          <button
            type="button"
            onClick={() => setIsProfileOpen((prev) => !prev)}
            className="w-full flex items-center gap-3 rounded-xl px-2.5 py-2 hover:bg-white/10 transition-colors cursor-pointer"
            aria-label="Open profile menu"
          >
            {userAvatar ? (
              <Image
                src={userAvatar}
                alt={displayName}
                width={36}
                height={36}
                className="w-9 h-9 rounded-full object-cover border border-white/30"
              />
            ) : (
              <span className="w-9 h-9 rounded-full border border-white/30 bg-white/10 text-white text-sm font-medium flex items-center justify-center">
                {profileInitial}
              </span>
            )}
            <div className="min-w-0 text-left">
              <p className="text-sm text-white truncate">{displayName}</p>
              <p className="text-xs text-white/60 truncate">{displayEmail || 'Profile'}</p>
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
