import { ChatMessageAttachment } from './chatApp';

/* ---------- Core UI message ---------- */
export interface ChatMessage {
  message_id: string;
  content: string;
  content_type: 'assistant' | 'user' | 'system';
  timestamp: string;
  attachments?: ChatMessageAttachment[];
  thoughts?: string;
}

/* ---------- Attachments from server ---------- */
export type ChatAttachmentFromServer = {
  name: string;
  type: string;
  url: string;
  size?: number;
  file?: File;
};

/* ---------- Message shape used across app ---------- */
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

  // NEW: model thoughts returned by Edge Function
  thoughts?: string;
}

/* ---------- Chat history ---------- */
export interface ChatHistory {
  conversation_id: string;
  messages: ChatMessage[];
}

export interface ChatHistoryResponse {
  message: string;
  data: ChatMessage[];
}

/* ---------- Formatted messages for UI ---------- */
export interface FormattedChatMessage {
  id: string;
  text: string;
  sender: 'assistant' | 'user' | 'system';
  timestamp: string;
}

/* ---------- Props ---------- */
export interface ChatProps {
  onClose: () => void;
  isDesktop: boolean;
  assistantImage: string;
  assistantName: string;
  isOpen: boolean;
}

/* ---------- Response from chatService.sendMessage ---------- */
export interface ChatMessageResponseData {
  response: string;
  message: ChatMessageFromServer;

  // NEW: pass-through thoughts
  thoughts?: string;
}

export interface ChatMessageResponse {
  message: string;
  data: ChatMessageResponseData;
}

/* ---------- Attachment input state ---------- */
export type ChatAttachmentInputState = {
  file: File;
  previewUrl?: string;
  type: 'image' | 'document';
};

/* ---------- Save interaction ---------- */
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
