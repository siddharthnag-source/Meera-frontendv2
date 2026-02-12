'use client';

import { ChatMessageFromServer } from '@/types/chat';
import React from 'react';

interface SidebarItemProps {
  message: ChatMessageFromServer;
  onSelect: (messageId: string) => void;
}

const normalize = (value?: string | null): string => value?.replace(/\s+/g, ' ').trim() ?? '';

const answerClampStyle: React.CSSProperties = {
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: 2,
  overflow: 'hidden',
};

export const SidebarItem: React.FC<SidebarItemProps> = ({ message, onSelect }) => {
  const userContext = normalize(message.user_context);
  const assistantAnswer = normalize(message.content);

  return (
    <button
      type="button"
      onClick={() => onSelect(message.message_id)}
      className="w-full rounded-lg px-2.5 py-2 text-left hover:bg-primary/10 transition-colors"
      title={`You: ${userContext || 'No context'}\nMeera: ${assistantAnswer || 'Untitled message'}`}
    >
      <p className="text-[11px] font-semibold text-primary/55 truncate">{`You: ${userContext || 'No context'}`}</p>
      <p className="mt-1 text-sm text-primary leading-5" style={answerClampStyle}>
        {`Meera: ${assistantAnswer || 'Untitled message'}`}
      </p>
    </button>
  );
};
