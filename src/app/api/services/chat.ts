import {
  ChatHistoryResponse,
  ChatMessageFromServer,
  ChatMessageResponse,
  SaveInteractionPayload,
} from '@/types/chat';

// We keep these here in case other code imports them
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
 * Build a single assistant message from plain text
 */
function buildAssistantMessage(text: string): ChatMessageFromServer {
  return {
    message_id: crypto.randomUUID(),
    content_type: 'assistant',
    content: text,
    timestamp: new Date().toISOString(),
    attachments: [],
    is_call: false,
    failed: false,
  };
}

/**
 * Build a ChatMessageResponse in the shape the UI expects:
 *   { message: 'ok', data: { response: string, message: ChatMessageFromServer } }
 */
function buildAssistantResponse(text: string): ChatMessageResponse {
  const assistantMessage = buildAssistantMessage(text);

  const chatResponse: ChatMessageResponse = {
    message: 'ok',
    data: {
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

    console.log('[chatService.sendMessage] stub called with:', message);

    // Small artificial delay so it feels real
    await new Promise((resolve) => setTimeout(resolve, 300));

    const replyText = message.trim()
      ? `Meera (local): I heard "${message}"`
      : 'Meera (local): I heard an empty message.';

    const response = buildAssistantResponse(replyText);

    console.log('[chatService.sendMessage] returning:', response);
    return response;
  },
};

/**
 * TEMP stub: do nothing, keep signature compatible.
 */
export const saveInteraction = async (
  payload: SaveInteractionPayload,
): Promise<void> => {
  void payload; // avoid unused-var lint
  // No backend call for now
};
