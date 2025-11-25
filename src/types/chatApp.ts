import { RefObject } from 'react';

// Attachment type for the input state (e.g., when a user selects a file before sending)
export interface ChatAttachmentInputState {
  type: 'image' | 'document';
  file: File;
  previewUrl: string;
  /**
   * Path of the object in Supabase Storage,
   * e.g. "meera-attachments/user-123/1711660000000-Deck.pdf"
   */
  storagePath?: string;
}

// Attachment type as it's stored/displayed within a message
export interface ChatMessageAttachment {
  type: string; // "image", "document", etc.
  url: string;
  name: string;
  size: number;
}

// Represents a message in the chat UI
export interface ChatUIMessage {
  id: string;
  content: string;
  isUser: boolean;
  timestamp: string;
  attachments?: ChatMessageAttachment[];
}

// Props for the main MeeraChat component
export interface MeeraChatProps {
  className?: string;
  isCompanyPage?: boolean;
  onClose?: () => void;
}

// Props for the MessageInput component
export interface MessageInputProps {
  inputValue: string;
  setInputValue: (value: string) => void;
  handleSubmit: (e: React.SyntheticEvent) => Promise<void>;
  isSending: boolean;
  attachments: ChatAttachmentInputState[];
  clearAttachments: () => void;
  removeAttachmentByIndex?: (index: number) => void;
  handleDocumentAttachment: () => void;
  handleImageAttachment: () => void;
  handleTakePhoto: () => void;
  toggleAttachMenu: (e: React.MouseEvent) => void;
  showAttachMenu: boolean;
  menuRef: RefObject<HTMLDivElement | null>;
  buttonRef: RefObject<HTMLButtonElement | null>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  setShowAttachMenu: (show: boolean) => void;
  formatFileSize: (bytes: number) => string;
}

// Props for the ChatInputFooter component
export interface ChatInputFooterProps {
  inputValue: string;
  setInputValue: (value: string) => void;
  handleSubmit: (e: React.SyntheticEvent) => void;
  isSending: boolean;
  attachments: ChatAttachmentInputState[];
  clearAttachments: () => void;
  removeAttachmentByIndex?: (index: number) => void;
  handleDocumentAttachment: () => void;
  handleImageAttachment: () => void;
  handleTakePhoto: () => void;
  toggleAttachMenu: (e: React.MouseEvent) => void;
  showAttachMenu: boolean;
  menuRef: React.RefObject<HTMLDivElement | null>;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  setShowAttachMenu: (show: boolean) => void;
  formatFileSize: (bytes: number) => string;
  hasMessages: boolean;
}
