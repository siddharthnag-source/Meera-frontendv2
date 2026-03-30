import { getGuestToken } from '@/lib/authRedirect';

interface LogDetails {
  message?: string;
  endpoint?: string;
  requestPayload?: unknown;
  userEmail?: string | null;
  guestToken?: string | null;
}

interface ErrorLogDetails extends LogDetails {
  errorResponse?: unknown;
  status?: number;
}

interface SuccessLogDetails extends LogDetails {
  successResponse?: unknown;
}

async function getClientAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (typeof window === 'undefined') {
    return headers;
  }

  try {
    const { supabase } = await import('@/lib/supabaseClient');
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token?.trim();
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
      return headers;
    }
  } catch {
    // Ignore and try guest token fallback.
  }

  try {
    const guestToken = getGuestToken();
    if (guestToken) {
      headers.Authorization = `Bearer ${guestToken}`;
    }
  } catch {
    // Ignore localStorage errors.
  }

  return headers;
}

export async function sendErrorToSlack({
  message,
  endpoint,
  requestPayload,
  errorResponse,
  status,
  userEmail,
  guestToken,
}: ErrorLogDetails): Promise<void> {
  try {
    let processedPayload = requestPayload;
    if (requestPayload instanceof FormData) {
      processedPayload = Object.fromEntries(requestPayload.entries());
    }

    const headers = await getClientAuthHeaders();

    const response = await fetch('/api/log-error-to-slack', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message,
        endpoint,
        requestPayload: processedPayload,
        errorResponse,
        status,
        userEmail,
        guestToken,
      }),
    });

    if (!response.ok) {
      console.error('Failed to send error to Slack');
    }
  } catch (err) {
    console.error('Failed to send error to Slack:', err);
  }
}

export async function sendSuccessToSlack({
  message,
  endpoint,
  requestPayload,
  successResponse,
  userEmail,
  guestToken,
}: SuccessLogDetails): Promise<void> {
  try {
    // Check if we're in a server-side context (NextAuth route)
    if (typeof window === 'undefined') {
      // Server-side: use direct webhook URL
      const SLACK_SUCCESS_LOG_WEBHOOK_URL = process.env.SLACK_SUCCESS_LOG_WEBHOOK_URL;

      if (!SLACK_SUCCESS_LOG_WEBHOOK_URL) {
        console.error('Slack success log skipped (URL not configured).');
        return;
      }

      let detailedText = `✅ Success Alert: ${message}`;

      if (userEmail) {
        detailedText += `\n*User:* ${userEmail}`;
      } else if (guestToken) {
        detailedText += `\n*Guest Token:* ${guestToken}`;
      }

      if (endpoint) {
        detailedText += `\n*Endpoint:* ${endpoint}`;
      }

      if (requestPayload) {
        detailedText += `\n*Request Payload:*\n\`\`\`\n${JSON.stringify(requestPayload, null, 2)}\n\`\`\``;
      }

      if (successResponse) {
        detailedText += `\n*Success Response:*\n\`\`\`\n${JSON.stringify(successResponse, null, 2)}\n\`\`\``;
      }

      await fetch(SLACK_SUCCESS_LOG_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: detailedText }),
      });
    } else {
      // Client-side: use API route
      const headers = await getClientAuthHeaders();
      const response = await fetch('/api/log-success-to-slack', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message,
          endpoint,
          requestPayload,
          successResponse,
          userEmail,
          guestToken,
        }),
      });

      if (!response.ok) {
        console.error('Failed to send success to Slack');
      }
    }
  } catch (err) {
    console.error('Failed to send success to Slack:', err);
  }
}

const SLACK_ERROR_LOG_WEBHOOK_URL = process.env.SLACK_ERROR_LOG_WEBHOOK_URL;

export async function sendAuthErrorToSlack({
  message,
  errorResponse,
  guestToken,
}: {
  message: string;
  errorResponse: unknown;
  guestToken?: string | null;
}) {
  if (!SLACK_ERROR_LOG_WEBHOOK_URL) {
    console.error('Slack error log skipped (URL not configured).');
    return;
  }

  try {
    let detailedText = `*Authentication Error Report:*\n*Message:* ${message}`;

    if (guestToken) {
      detailedText += `\n*Guest Token:* ${guestToken}`;
    }

    if (errorResponse) {
      detailedText += `\n*Error Details:*\n\`\`\`\n${JSON.stringify(errorResponse, null, 2)}\n\`\`\``;
    }

    await fetch(SLACK_ERROR_LOG_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: detailedText }),
    });
  } catch (err) {
    console.error('Failed to send auth error to Slack:', err);
  }
}
