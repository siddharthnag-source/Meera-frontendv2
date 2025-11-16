/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/ban-ts-comment */

import {
  ChatHistoryResponse,
  ChatMessageResponse,
  SaveInteractionPayload,
} from '@/types/chat';
import { api } from '../client';
import { API_ENDPOINTS } from '../config';

// Supabase Edge Function endpoint + keys
const SUPABASE_CHAT_URL = process.env.NEXT_PUBLIC_SUPABASE_CHAT_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

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

  // Non-streaming sendMessage that talks to the Supabase Edge Function
  async sendMessage(formData: FormData): Promise<ChatMessageResponse | Response> {
    const message = (formData.get('message') as string) || '';

    try {
      const response = await fetch(SUPABASE_CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
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

      const assistantMessage: any = {
        message_id: crypto.randomUUID(),
        content_type: 'assistant',
        content: body.reply,
        timestamp: new Date().toISOString(),
        attachments: [],
        is_call: false,
        failed: false,
      };

      const chatResponse: ChatMessageResponse = {
        // @ts-ignore – we’re matching the runtime shape the UI uses
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
