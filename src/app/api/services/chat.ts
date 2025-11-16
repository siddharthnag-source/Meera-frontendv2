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
  /**
   * TEMP: no real backend history yet, so just return an empty list.
   */
  async getChatHistory(page: number = 1): Promise<ChatHistoryResponse> {
    // “Use” the argument so ESLint is happy (we ignore it for now).
    void page;

    const emptyHistory = {
      message: 'ok',
      data: {
        response: [] as ChatMessageFromServer[],
      },
    } as unknown as ChatHistoryResponse;

    return emptyHistory;
  },

  /**
   * Non-streaming sendMessage that calls the Supabase Edge Function
   * and adapts the reply into the shape the UI expects.
   */
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

      const body = (await response.json()) as { reply: string };

      const assistantMessage: ChatMessageFromServer = {
        message_id: crypto.randomUUID(),
        content_type: 'assistant',
        content: body.reply,
        timestamp: new Date().toISOString(),
        attachments: [],
        is_call: false,
        failed: false,
      };

      const chatResponse = {
        message: 'ok',
        data: {
          response: [assistantMessage],
        },
      } as unknown as ChatMessageResponse;

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
