'use client';

import { ChatMessageFromServer } from '@/types/chat';
import Image from 'next/image';
import React, { useCallback, useState } from 'react';
import { FiChevronLeft, FiChevronRight, FiPlus, FiX } from 'react-icons/fi';
import { ProfileMenu } from './ProfileMenu';

interface SidebarProps {
  tokensLeft?: number | null;
  starredMessages: ChatMessageFromServer[];
  onSelectStarredMessage: (messageId: string) => void;
  userName: string;
  userEmail: string;
  userAvatar?: string | null;
  isExpanded: boolean;
  isVisible: boolean;
  onToggleExpand: () => void;
  onCloseSidebar: () => void;
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
  isExpanded,
  isVisible,
  onToggleExpand,
  onCloseSidebar,
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

  const sidebarWidthClass = isExpanded ? 'w-[260px]' : 'w-[80px]';

  return (
    <>
      <aside
        className={`hidden md:flex fixed left-0 top-0 h-screen z-40 bg-black border-r border-white/20 flex-col transition-[width] duration-200 ${sidebarWidthClass}`}
      >
        <div className="p-4 border-b border-white/20">
          <div className="flex items-center justify-between mb-3">
            {isExpanded ? (
              <div className="text-white text-base font-semibold truncate">
                {process.env.NEXT_PUBLIC_APP_NAME || 'Meera'}
              </div>
            ) : (
              <div className="text-white text-base font-semibold">M</div>
            )}

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onToggleExpand}
                className="w-7 h-7 rounded-md text-white/80 hover:text-white hover:bg-white/10 transition-colors flex items-center justify-center"
                aria-label={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
                title={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
              >
                {isExpanded ? <FiChevronLeft size={16} /> : <FiChevronRight size={16} />}
              </button>
              <button
                type="button"
                onClick={onCloseSidebar}
                className="w-7 h-7 rounded-md text-white/80 hover:text-white hover:bg-white/10 transition-colors flex items-center justify-center"
                aria-label="Close sidebar"
                title="Close sidebar"
              >
                <FiX size={16} />
              </button>
            </div>
          </div>

          <button
            type="button"
            className={`w-full rounded-xl border border-white/20 bg-white/5 py-2 text-sm text-white hover:bg-white/10 transition-colors flex items-center ${
              isExpanded ? 'px-3 justify-start gap-2' : 'justify-center'
            }`}
          >
            <FiPlus size={15} />
            {isExpanded && <span>New chat</span>}
          </button>
        </div>

        <div className={`flex-1 overflow-y-auto ${isExpanded ? 'p-4' : 'p-2'}`}>
          <p className={`text-white/50 ${isExpanded ? 'text-sm' : 'text-xs text-center'}`}>Chat history coming soon.</p>
        </div>

        <div className="p-4 border-t border-white/20">
          <button
            type="button"
            onClick={() => setIsProfileOpen((prev) => !prev)}
            className={`w-full flex items-center rounded-xl px-2.5 py-2 hover:bg-white/10 transition-colors cursor-pointer ${
              isExpanded ? 'gap-3' : 'justify-center'
            }`}
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
            {isExpanded && (
              <div className="min-w-0 text-left">
                <p className="text-sm text-white truncate">{displayName}</p>
                <p className="text-xs text-white/60 truncate">{displayEmail || 'Profile'}</p>
              </div>
            )}
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
