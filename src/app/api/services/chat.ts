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

/**
 * Build a ChatMessageResponse object in the exact shape
 * that the Conversation UI expects.
 */
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
      response: text,
      message: assistantMessage,
    } as ChatMessageResponse['data'],
  };

  return chatResponse;
}

export const chatService = {
  /**
   * Stubbed chat history – no old backend.
   */
  async getChatHistory(page: number = 1): Promise<ChatHistoryResponse> {
    void page; // avoid unused-var lint

    const emptyHistory: ChatHistoryResponse = {
      message: 'ok',
      data: [],
    };

    return emptyHistory;
  },

  /**
   * Send message directly to Supabase Edge Function.
   * Always returns a non-streaming ChatMessageResponse.
   */
  async sendMessage(formData: FormData): Promise<ChatMessageResponse> {
    const message = (formData.get('message') as string) || '';

    console.log('[chatService.sendMessage] calling Supabase with:', message);

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
          errorBody.error || errorBody.detail || 'Failed to get reply from Supabase',
          response.status,
          errorBody,
        );
      }

      const body = (await response.json()) as { reply: string };

      const replyText =
        typeof body.reply === 'string' && body.reply.trim().length > 0
          ? body.reply
          : 'Meera: I received your message but Supabase did not send any reply.';

      const chatResponse = buildAssistantResponse(replyText);

      console.log('[chatService.sendMessage] Supabase reply mapped to:', chatResponse);

      return chatResponse;
    } catch (error) {
      console.error('Error in sendMessage (Supabase):', error);
      throw error;
    }
  },
};

/**
 * Keep this if some parts of the UI still call saveInteraction.
 * If you truly want zero backend calls, you can later turn this
 * into a no-op or delete all usages.
 */
export const saveInteraction = (payload: SaveInteractionPayload) => {
  return api.post(API_ENDPOINTS.CALL.SAVE_INTERACTION, payload);
};
