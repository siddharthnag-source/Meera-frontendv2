import {
  ChatHistoryResponse,
  ChatMessageResponse,
  SaveInteractionPayload,
  ChatMessageFromServer,
} from '@/types/chat';
import { api } from '../client';
import { API_ENDPOINTS } from '../config';

// Supabase Edge Function endpoint for the `chat` function
const SUPABASE_CHAT_URL =
  'https://xilapyewazpzlvqbbtgl.supabase.co/functions/v1/chat';

export class SessionExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

export class ApiError extends Error {
  status: number;
  body: { detail?: string };

  constructor(message: string, status: number, body: { detail?: string }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export const chatService = {
  async getChatHistory(page: number = 1): Promise<ChatHistoryResponse> {
    try {
      return await api.get<ChatHistoryResponse>(
        `${API_ENDPOINTS.CHAT.HISTORY}?page=${page}`,
      );
    } catch (error) {
      console.error('Error in getChatHistory:', error);
      throw error;
    }
  },

  // Simple, non-streaming sendMessage that talks to the Supabase Edge Function
  async sendMessage(
    formData: FormData,
  ): Promise<ChatMessageResponse | Response> {
    const message = (formData.get('message') as string) || '';

    try {
      const response = await fetch(SUPABASE_CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message }),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ error: '' }));
        throw new ApiError(
          errorBody.error || 'Failed to get reply from Meera',
          response.status,
          errorBody,
        );
      }

      const body = await response.json(); // expected shape: { reply: string }

      // Strongly-typed assistant message object for the UI
      const assistantMessage: ChatMessageFromServer = {
        message_id: crypto.randomUUID(),
        content_type: 'assistant',
        content: body.reply,
        timestamp: new Date().toISOString(),
        attachments: [],
        is_call: false,
        failed: false,
      };

      // Adapt into ChatMessageResponse (add required `message` field)
      const chatResponse: ChatMessageResponse = {
        message: 'ok',
        data: [assistantMessage],
      };

      return chatResponse;
    } catch (error) {
      console.error('Error in sendMessage:', error);
      throw error;
    }
  },
};

export const saveInteraction = (payload: SaveInteractionPayload) => {
  return api.post(API_ENDPOINTS.CALL.SAVE_INTERACTION, payload);
};
