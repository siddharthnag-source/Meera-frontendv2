import {
  ChatHistoryResponse,
  ChatMessage,
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
   * Fetch chat history for the currently logged-in user.
   * Backend (`/api/history`) returns ChatMessageFromServer[], but
   * ChatHistoryResponse expects ChatMessage[].
   *
   * We simply cast here so TypeScript is happy and the UI can use it.
   */
  async getChatHistory(page: number = 1): Promise<ChatHistoryResponse> {
    try {
      const res = await fetch(`/api/history?page=${page}`, {
        method: 'GET',
      });

      if (!res.ok) {
        console.error('getChatHistory: response not ok', res.status);
        return {
          message: 'error',
          data: [],
        };
      }

      const json = (await res.json()) as {
        data?: ChatMessageFromServer[];
        error?: string | null;
      };

      // Cast server messages to ChatMessage[] to satisfy types.
      // Runtime shape is close enough for our UI usage.
      const data = (json?.data ?? []) as unknown as ChatMessage[];

      return {
        message: json?.error ?? 'ok',
        data,
      };
    } catch (error) {
      console.error('getChatHistory: unexpected error', error);
      return {
        message: 'error',
        data: [],
      };
    }
  },

  /**
   * Simple non-streaming sendMessage → Supabase Edge Function → JSON → ChatMessageResponse
   */
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
        // fields that exist on ChatMessageFromServer
        attachments: [],
        is_call: false,
        failed: false,
        finish_reason: null,
      };

      const chatResponse: ChatMessageResponse = {
        message: 'ok',
        data: {
          response: body.reply,
          // cast to ChatMessage to satisfy the type of ChatMessageResponse
          message: assistantMessage as unknown as ChatMessage,
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
