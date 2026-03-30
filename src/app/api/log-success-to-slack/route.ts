import { NextResponse } from 'next/server';

const SLACK_SUCCESS_LOG_WEBHOOK_URL = process.env.SLACK_SUCCESS_LOG_WEBHOOK_URL;
const SLACK_LOG_INTERNAL_TOKEN = process.env.SLACK_LOG_INTERNAL_TOKEN ?? '';
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const AUTH_TIMEOUT_MS = 3500;
const MAX_BODY_BYTES = 100_000;

interface SlackPayload {
  text: string;
}

interface SuccessLogPayload {
  message: string;
  endpoint?: string;
  requestPayload?: unknown;
  successResponse?: unknown;
  userEmail?: string | null;
  guestToken?: string | null;
}

function getBearerToken(request: Request): string {
  const authHeader = request.headers.get('authorization') ?? '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) return '';
  return authHeader.slice('bearer '.length).trim();
}

async function isAuthorizedRequest(request: Request): Promise<boolean> {
  const internalToken = request.headers.get('x-slack-log-token')?.trim() ?? '';
  if (SLACK_LOG_INTERNAL_TOKEN && internalToken === SLACK_LOG_INTERNAL_TOKEN) {
    return true;
  }

  const bearerToken = getBearerToken(request);
  if (!bearerToken || !SUPABASE_URL || !SUPABASE_ANON_KEY) return false;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);

  try {
    const authResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        apikey: SUPABASE_ANON_KEY,
      },
      cache: 'no-store',
      signal: controller.signal,
    });

    return authResponse.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function POST(request: Request) {
  if (!SLACK_SUCCESS_LOG_WEBHOOK_URL) {
    return NextResponse.json(
      {
        message: 'API call failed, Slack success log skipped (Success Log URL not configured).',
      },
      { status: 500 },
    );
  }

  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ message: 'Payload too large' }, { status: 413 });
  }

  if (!(await isAuthorizedRequest(request))) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { message, endpoint, requestPayload, successResponse, userEmail, guestToken }: SuccessLogPayload =
      await request.json();

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

    const payload: SlackPayload = {
      text: detailedText,
    };

    const slackResponse = await fetch(SLACK_SUCCESS_LOG_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!slackResponse.ok) {
      return NextResponse.json({ message: 'Success log failed to send to Slack' }, { status: 500 });
    }
    return NextResponse.json({ message: 'Success logged to Slack' }, { status: 200 });
  } catch {
    return NextResponse.json({ message: 'Internal server error while processing success log' }, { status: 500 });
  }
}
