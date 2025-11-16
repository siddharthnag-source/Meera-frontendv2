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
   * Stubbed chat history – we don’t hit the old backend at all.
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
   * - If `streaming === 'true'` in the form data, we return a `Response`
   *   with a readable body so the existing streaming code is satisfied.
   * - Otherwise we return a normal `ChatMessageResponse`.
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

      // If the UI requested streaming, return a Response with a readable body.
      if (isStreaming) {
        // Plain text body is enough – Response.body will be a ReadableStream,
        // so the existing streaming reader won’t throw "Expected streaming response".
        return new Response(replyText, {
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }

      // Non-streaming code path: return the structured chat response.
      return chatResponse;
    } catch (error) {
      console.error('Error in sendMessage (Supabase):', error);
      throw error;
    }
  },
};

/**
 * Kept only so other parts of the app that import saveInteraction don’t break.
 * Currently a no-op: we are not talking to any legacy backend here.
 */
export const saveInteraction = async (_payload: SaveInteractionPayload): Promise<void> => {
  void _payload;
};
