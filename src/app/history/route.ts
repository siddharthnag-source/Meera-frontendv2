// src/app/api/history/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import type { Database } from '@/types/supabase';
import type { ChatHistoryResponse, ChatMessageFromServer } from '@/types/chat';

const CHAT_LOG_TABLE = 'messages';

type LegacyMessageRow = {
  message_id: string;
  user_id: string;
  content_type: 'assistant' | 'user';
  content: string;
  timestamp: string;
};

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const page = Number.parseInt(searchParams.get('page') ?? '1', 10);
    const pageSize = 20;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const supabase = createRouteHandlerClient<Database>({ cookies });

    // 1) Get current user session
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    // If no user, just return empty history (UI will show "No messages found")
    if (sessionError || !session?.user) {
      const empty: ChatHistoryResponse = { message: 'ok', data: [] };
      return NextResponse.json(empty);
    }

    // 2) Fetch messages for this user from `messages` table
    const { data, error } = await supabase
      .from<LegacyMessageRow>(CHAT_LOG_TABLE)
      .select('message_id,user_id,content_type,content,timestamp')
      .eq('user_id', session.user.id)
      .order('timestamp', { ascending: true })
      .range(from, to);

    if (error) {
      console.error('history select error', error);
      const empty: ChatHistoryResponse = { message: 'ok', data: [] };
      return NextResponse.json(empty);
    }

    const rows = data ?? [];

    // 3) Map DB rows → ChatMessageFromServer objects used by the UI
    const messages: ChatMessageFromServer[] = rows.map((row) => ({
      message_id: row.message_id,
      content_type: row.content_type === 'assistant' ? 'assistant' : 'user',
      content: row.content,
      timestamp: row.timestamp,
      attachments: [],
      is_call: false,
      failed: false,
    }));

    const response: ChatHistoryResponse = {
      message: 'ok',
      data: messages,
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error('history handler error', err);
    const empty: ChatHistoryResponse = { message: 'ok', data: [] };
    return NextResponse.json(empty);
  }
}
