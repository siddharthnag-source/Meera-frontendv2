// src/app/api/services/chat.ts

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
  // Simple stub so the UI can render an empty conversation
  async getChatHistory(page: number = 1): Promise<ChatHistoryResponse> {
    void page; // avoid unused var lint

    const emptyHistory: ChatHistoryResponse = {
      message: 'ok',
      data: [],
    };

    return emptyHistory;
  },

  // Non-streaming sendMessage that calls Supabase Edge Function
  async sendMessage(formData: FormData): Promise<ChatMessageResponse> {
    // Try to read the message from the form in a tolerant way
    const raw =
      formData.get('message') ??
      formData.get('content') ??
      formData.get('text');

    const message = typeof raw === 'string' ? raw : '';

    if (!message) {
      // Frontend should never send an empty message; if it does we fail fast
      throw new Error('No message content provided');
    }

    if (!SUPABASE_CHAT_URL) {
      throw new Error('Supabase chat URL is not configured');
    }

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

      // We expect the Supabase function to return: { reply: "Meera heard: hi" }
      const body = (await response.json().catch(() => ({}))) as { reply?: string };

      const replyText = body.reply ?? '';

      const assistantMessage: ChatMessageFromServer = {
        message_id:
          (typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : Math.random().toString(36).slice(2)),
        content_type: 'assistant',
        content: replyText,
        timestamp: new Date().toISOString(),
        attachments: [],
        is_call: false,
        failed: false,
      };

      const chatResponse: ChatMessageResponse = {
        message: 'ok',
        data: {
          response: replyText,
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
