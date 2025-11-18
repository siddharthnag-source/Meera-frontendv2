import {
  ChatHistoryResponse,
  ChatMessageFromServer,
  ChatMessageResponse,
  SaveInteractionPayload,
} from '@/types/chat';
import { api } from '../client';
import { API_ENDPOINTS } from '../config';

// Supabase Edge Function endpoint for the `chat` function
const SUPABASE_CHAT_URL =
  process.env.NEXT_PUBLIC_SUPABASE_CHAT_URL ??
  'https://xilapyewazpzlvqbbtgl.supabase.co/functions/v1/chat';

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

export const chatService = {
  /**
   * Load chat history for the currently logged-in user.
   * This calls our Next.js API route `/api/history`, which:
   *   - Reads the Supabase auth user from cookies
   *   - Maps email -> legacy users.id
   *   - Returns messages for that legacy user_id
   */
  async getChatHistory(page: number = 1): Promise<ChatHistoryResponse> {
    try {
      const res = await fetch(`/api/history?page=${page}`, {
        method: 'GET',
        credentials: 'include',
      });

      if (!res.ok) {
        console.error('getChatHistory: HTTP error', res.status);
        return {
          message: 'error',
          data: [],
        };
      }

      const json = (await res.json()) as {
        data?: ChatMessageFromServer[];
        error?: string;
      };

      return {
        message: json?.error ?? 'ok',
        data: json?.data ?? [],
      };
    } catch (error) {
      console.error('getChatHistory: unexpected error', error);
      return {
        message: 'error',
        data: [],
      };
    }
  },

  // Simple non-streaming sendMessage → Supabase → JSON → ChatMessageResponse
  async sendMessage(formData: FormData): Promise<ChatMessageResponse> {
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
        const errorBody = (await response.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };

        throw new ApiError(
          errorBody.error || errorBody.detail || 'Failed to get reply from Meera',
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

      const chatResponse: ChatMessageResponse = {
        message: 'ok',
        data: {
          response: body.reply,
          message: assistantMessage,
        } as ChatMessageResponse['data'],
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
