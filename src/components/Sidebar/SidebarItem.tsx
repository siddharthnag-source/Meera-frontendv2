'use client';

import { ChatMessageFromServer } from '@/types/chat';
import React from 'react';

interface SidebarItemProps {
  message: ChatMessageFromServer;
  onSelect: (messageId: string) => void;
}

const normalize = (value?: string | null): string => value?.replace(/\s+/g, ' ').trim() ?? '';

export const SidebarItem: React.FC<SidebarItemProps> = ({ message, onSelect }) => {
  const summary = normalize(message.summary) || normalize(message.user_context) || normalize(message.content) || 'Saved Memory';

  return (
    <button
      type="button"
      onClick={() => onSelect(message.message_id)}
      className="w-full rounded-lg px-2.5 py-2 text-left hover:bg-primary/10 transition-colors"
      title={summary}
    >
      <span className="block truncate text-sm font-medium text-primary">{summary}</span>
    </button>
  );
};
