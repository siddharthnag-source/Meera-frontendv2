import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Server side admin client. DO NOT expose this key to the browser.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// For now we hardcode your user id so that history works for you.
const CURRENT_USER_ID = '39383ba4-16a8-4a5f-81d7-6b844b4587a5';

type DbMessageRow = {
  message_id: string;
  user_id: string;
  content_type: 'user' | 'assistant';
  content: string;
  timestamp: string;
};

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  attachments: any[]; // currently unused
};

export async function GET(_req: NextRequest) {
  try {
    const { data, error } = await supabaseAdmin
      .from<DbMessageRow>('messages')
      .select('message_id, user_id, content_type, content, timestamp')
      .eq('user_id', CURRENT_USER_ID)
      .order('timestamp', { ascending: true })
      .limit(100);

    if (error) {
      console.error('Supabase error in /api/history:', error);
      return NextResponse.json(
        { error: error.message, data: [] as ChatMessage[] },
        { status: 500 }
      );
    }

    const rows = data ?? [];

    const mapped: ChatMessage[] = rows.map((row) => ({
      id: row.message_id,
      role: row.content_type,
      content: row.content,
      createdAt: row.timestamp,
      attachments: [], // no attachments for history yet
    }));

    return NextResponse.json({ data: mapped });
  } catch (err) {
    console.error('Unexpected error in /api/history:', err);
    return NextResponse.json(
      { error: 'Unexpected error while fetching history', data: [] as ChatMessage[] },
      { status: 500 }
    );
  }
}
