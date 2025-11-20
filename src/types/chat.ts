import { ChatMessageAttachment } from './chatApp';

export interface ChatMessage {
  message_id: string;
  content: string;
  content_type: 'assistant' | 'user' | 'system';
  timestamp: string;
  attachments?: ChatMessageAttachment[];
}

export interface FormattedChatMessage {
  id: string;
  text: string;
  sender: 'assistant' | 'user' | 'system';
  timestamp: string;
}

export interface ChatHistory {
  conversation_id: string;
  messages: ChatMessage[];
}

export interface ChatHistoryResponse {
  message: string;
  data: ChatMessage[];
}

export interface ChatProps {
  onClose: () => void;
  isDesktop: boolean;
  assistantImage: string;
  assistantName: string;
  isOpen: boolean;
}

export interface ChatMessageResponseData {
  response: string;
}

export interface ChatMessageResponse {
  message: string;
  data: ChatMessageResponseData;
}

export type ChatAttachmentFromServer = {
  name: string;
  type: string;
  url: string;
  size?: number;
  file?: File;
};

export interface ChatMessageFromServer {
  message_id: string;
  content: string;
  content_type: 'user' | 'assistant' | 'system';
  timestamp: string;
  attachments?: ChatAttachmentFromServer[];
  is_call?: boolean;
  session_id?: string;
  finish_reason?: string | null;
  failed?: boolean;
  try_number?: number;
  failedMessage?: string;
  isGeneratingImage?: boolean;
}

export type ChatAttachmentInputState = {
  file: File;
  previewUrl?: string;
  type: 'image' | 'document';
};

export interface SaveInteractionPayload {
  user_message: string;
  assistant_message: string;
  user_message_tokens?: number;
  assistant_message_tokens?: number;
  device?: string;
  location?: string;
  network?: string;
  session_id?: string;
}
