'use client';

import { ChatMessageFromServer } from '@/types/chat';
import Image from 'next/image';
import React from 'react';
import { FiLogOut, FiSettings } from 'react-icons/fi';

interface ProfileMenuProps {
  isOpen: boolean;
  onClose: () => void;
  userName: string;
  userEmail: string;
  userAvatar?: string | null;
  tokensLeft?: number | null;
  starredMessages: ChatMessageFromServer[];
  onSelectStarredMessage: (messageId: string) => void;
  onOpenSettings: () => void;
  onSignOut: () => void;
  anchor?: 'top-left' | 'sidebar-bottom';
}

const buildPreview = (content: string): string => {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) return 'Untitled message';
  if (normalized.length <= 72) return normalized;
  return `${normalized.slice(0, 72)}...`;
};

export const ProfileMenu: React.FC<ProfileMenuProps> = ({
  isOpen,
  onClose,
  userName,
  userEmail,
  userAvatar,
  tokensLeft,
  starredMessages,
  onSelectStarredMessage,
  onOpenSettings,
  onSignOut,
  anchor = 'sidebar-bottom',
}) => {
  if (!isOpen) return null;

  const displayName = userName.trim() || 'Profile';
  const displayEmail = userEmail.trim();
  const initial = displayName.charAt(0).toUpperCase() || 'P';
  const tokenText = typeof tokensLeft === 'number' ? tokensLeft.toLocaleString() : '...';

  const handleSelectMessage = (messageId: string) => {
    onSelectStarredMessage(messageId);
    onClose();
  };

  const menuPositionClass = anchor === 'top-left' ? 'top-16 left-4' : 'bottom-24 left-4';

  return (
    <div className="fixed inset-0 z-50">
      <button onClick={onClose} className="absolute inset-0 bg-black/25" aria-label="Close profile menu backdrop" />

      <section
        className={`absolute ${menuPositionClass} w-[min(92vw,340px)] rounded-xl border border-white/20 bg-gray-900 shadow-xl`}
      >
        <header className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-white/10">
          {userAvatar ? (
            <Image
              src={userAvatar}
              alt={displayName}
              width={40}
              height={40}
              className="w-10 h-10 rounded-full object-cover border border-white/20"
            />
          ) : (
            <span className="w-10 h-10 rounded-full border border-white/20 bg-white/10 text-white text-sm font-medium flex items-center justify-center">
              {initial}
            </span>
          )}

          <div className="min-w-0">
            <p className="text-sm font-medium text-white truncate">{displayName}</p>
            <p className="text-xs text-white/60 truncate">{displayEmail || 'No email'}</p>
          </div>
        </header>

        <div className="px-4 py-3 border-b border-white/10">
          <p className="text-[11px] uppercase tracking-[0.12em] text-white/55">Consciousness Cost</p>
          <div className="mt-2 rounded-lg border border-white/20 bg-white/5 px-3 py-2">
            <p className="text-xs text-white/60">Tokens</p>
            <p className="text-base font-medium text-white">{tokenText}</p>
          </div>
        </div>

        <div className="px-4 py-3 border-b border-white/10">
          <p className="text-[11px] uppercase tracking-[0.12em] text-white/55">Memory</p>
          {starredMessages.length === 0 ? (
            <p className="mt-2 text-sm text-white/50">No starred messages</p>
          ) : (
            <ul className="mt-2 space-y-1 max-h-52 overflow-y-auto">
              {starredMessages.map((message) => (
                <li key={message.message_id}>
                  <button
                    onClick={() => handleSelectMessage(message.message_id)}
                    className="w-full rounded-lg px-2.5 py-2 text-left hover:bg-white/10 transition-colors"
                    title={message.content}
                  >
                    <p className="text-sm text-white truncate">{buildPreview(message.content)}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="p-2">
          <button
            onClick={onOpenSettings}
            className="w-full rounded-lg px-2.5 py-2 text-left text-sm text-white hover:bg-white/10 transition-colors flex items-center gap-2"
          >
            <FiSettings size={16} />
            <span>Settings</span>
          </button>
          <button
            onClick={onSignOut}
            className="w-full rounded-lg px-2.5 py-2 text-left text-sm text-white hover:bg-white/10 transition-colors flex items-center gap-2"
          >
            <FiLogOut size={16} />
            <span>Sign out</span>
          </button>
        </footer>
      </section>
    </div>
  );
};
