import {
  ChatHistoryResponse,
  ChatMessageFromServer,
  ChatMessageResponse,
  SaveInteractionPayload,
} from '@/types/chat';

// Supabase Edge Function endpoint for the `chat` function
const SUPABASE_CHAT_URL =
  process.env.NEXT_PUBLIC_SUPABASE_CHAT_URL ??
  'https://xilapyewazpzlvqbbtgl.supabase.co/functions/v1/chat';

/**
 * Kept only so existing code that imports it (useMessageSubmission) compiles.
 * We do NOT currently throw this from chatService.
 */
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
   * Stubbed chat history – no legacy backend.
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
   *
   * - If `streaming === 'true'`, return a `Response` with a body so the
   *   existing streaming code path is satisfied.
   * - Otherwise return a normal `ChatMessageResponse`.
   */
  async sendMessage(formData: FormData): Promise<ChatMessageResponse | Response> {
    const message = (formData.get('message') as string) || '';
    const isStreaming = formData.get('streaming') === 'true';

    console.log('[chatService.sendMessage] calling Supabase with:', message, {
      streaming: isStreaming,
    });

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

      // Streaming path: return a Response with a readable body.
      if (isStreaming) {
        return new Response(replyText, {
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }

      // Non-streaming path.
      return chatResponse;
    } catch (error) {
      console.error('Error in sendMessage (Supabase):', error);
      throw error;
    }
  },
};

/**
 * No-op stub so callers don’t break; we are not using the old backend.
 */
export const saveInteraction = async (_payload: SaveInteractionPayload): Promise<void> => {
  void _payload;
};
