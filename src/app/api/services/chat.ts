import {
  ChatHistoryResponse,
  ChatMessageFromServer,
  ChatMessageResponse,
  SaveInteractionPayload,
} from '@/types/chat';
import { api } from '../client';
import { API_ENDPOINTS } from '../config';

export class SessionExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

export class ApiError extends Error {
  status: number;
  body: { detail?: string; error?: string };

  constructor(message: string, status: number, body: { detail?: string; error?: string }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

// ---------- Helpers ----------

function buildAssistantResponse(text: string): ChatMessageResponse {
  const assistantMessage: ChatMessageFromServer = {
    message_id: crypto.randomUUID(),
    content_type: 'assistant',
    content: text,
    timestamp: new Date().toISOString(),
    attachments: [],
    is_call: false,
    failed: false,
  };

  const chatResponse: ChatMessageResponse = {
    message: 'ok',
    data: {
      // IMPORTANT: shape must match ChatMessageResponse['data']
      response: text,
      message: assistantMessage,
    } as ChatMessageResponse['data'],
  };

  return chatResponse;
}

// ---------- Public API used by the UI ----------

export const chatService = {
  // Stub chat history so UI can render without any backend
  async getChatHistory(page: number = 1): Promise<ChatHistoryResponse> {
    void page; // avoid unused-var lint

    const emptyHistory: ChatHistoryResponse = {
      message: 'ok',
      data: [],
    };

    return emptyHistory;
  },

  // TEMP: Pure frontend bot – no network call at all
  async sendMessage(formData: FormData): Promise<ChatMessageResponse> {
    const message = (formData.get('message') as string) || '';

    // Small artificial delay so it feels real
    await new Promise((resolve) => setTimeout(resolve, 300));

    const replyText = message.trim()
      ? `Meera (local): I heard "${message}"`
      : 'Meera (local): I heard an empty message.';

    return buildAssistantResponse(replyText);
  },
};

export const saveInteraction = (payload: SaveInteractionPayload) => {
  return api.post(API_ENDPOINTS.CALL.SAVE_INTERACTION, payload);
};
