'use client';

import { ChatMessageFromServer } from '@/types/chat';
import Image from 'next/image';
import Link from 'next/link';
import React from 'react';
import { FiX } from 'react-icons/fi';

interface SidebarProps {
  tokensLeft?: number | null;
  starredMessages: ChatMessageFromServer[];
  onSelectMessage: (messageId: string) => void;
  userName: string;
  userAvatar?: string | null;
  isMobileOpen: boolean;
  onCloseMobile: () => void;
}

const buildPreview = (content: string): string => {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) return 'Untitled message';
  if (normalized.length <= 80) return normalized;
  return `${normalized.slice(0, 80)}...`;
};

export const Sidebar: React.FC<SidebarProps> = ({
  tokensLeft,
  starredMessages,
  onSelectMessage,
  userName,
  userAvatar,
  isMobileOpen,
  onCloseMobile,
}) => {
  const tokenText = typeof tokensLeft === 'number' ? tokensLeft.toLocaleString() : '...';
  const displayName = userName.trim() || 'Profile';
  const fallbackInitial = displayName.charAt(0).toUpperCase() || 'P';

  const handleSelect = (messageId: string) => {
    onSelectMessage(messageId);
    onCloseMobile();
  };

  const renderContent = (isMobile: boolean) => (
    <>
      <header className="px-4 pt-4 pb-3 border-b border-primary/10">
        <div className="flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-[0.12em] text-primary/55">Memory</p>
          {isMobile && (
            <button
              onClick={onCloseMobile}
              className="p-1 rounded-md text-primary/70 hover:text-primary hover:bg-background transition-colors"
              aria-label="Close sidebar"
            >
              <FiX size={16} />
            </button>
          )}
        </div>
        <div className="mt-3 inline-flex items-center rounded-full border border-primary/20 bg-background px-3 py-1.5">
          <span className="text-sm font-medium text-primary">Tokens: {tokenText}</span>
        </div>
      </header>

      <section className="flex-1 overflow-y-auto px-2 py-3">
        {starredMessages.length === 0 ? (
          <p className="px-2 pt-2 text-sm text-primary/50">No starred messages</p>
        ) : (
          <ul className="space-y-1">
            {starredMessages.map((message) => (
              <li key={message.message_id}>
                <button
                  onClick={() => handleSelect(message.message_id)}
                  className="w-full text-left rounded-lg px-2.5 py-2 bg-transparent hover:bg-background transition-colors"
                  title={message.content}
                >
                  <p className="text-sm text-primary truncate">{buildPreview(message.content)}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="border-t border-primary/10 p-3 mt-auto">
        <Link
          href="/"
          className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-background transition-colors"
          aria-label="Go to home"
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
            <span className="w-8 h-8 rounded-full border border-primary/20 bg-background text-primary text-sm font-medium flex items-center justify-center">
              {fallbackInitial}
            </span>
          )}
          <span className="text-sm text-primary truncate">{displayName}</span>
        </Link>
      </footer>
    </>
  );

  return (
    <>
      <aside className="hidden md:flex fixed left-0 top-0 z-40 h-screen w-[260px] bg-card border-r border-primary/20 flex-col">
        {renderContent(false)}
      </aside>

      <div
        className={`md:hidden fixed inset-0 z-50 transition-opacity duration-200 ${
          isMobileOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        <button onClick={onCloseMobile} className="absolute inset-0 bg-black/20" aria-label="Close sidebar backdrop" />
        <aside
          className={`fixed left-0 top-0 z-[60] h-screen w-[260px] bg-card border-r border-primary/20 flex flex-col transform transition-transform duration-200 ${
            isMobileOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          {renderContent(true)}
        </aside>
      </div>
    </>
  );
};
