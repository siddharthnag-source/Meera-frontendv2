import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import type { ChatMessageFromServer } from '@/types/chat';

// Shape of a legacy row in `messages` table
type LegacyMessageRow = {
  message_id: string;
  user_id: string;
  content_type: string;
  content: string;
  timestamp: string;
  session_id?: string | null;
  is_call?: boolean | null;
};

export async function GET(req: NextRequest) {
  try {
    const cookieStore = cookies();
    const supabase = createRouteHandlerClient({ cookies: () => cookieStore });

    // 1) Authenticated Supabase user (Google login)
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user?.email) {
      console.error('history: auth error', userError);
      return NextResponse.json({ data: [], error: 'Not authenticated' }, { status: 401 });
    }

    const email = user.email;

    // 2) Find legacy user row by email
    const { data: legacyUser, error: legacyError } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (legacyError) {
      console.error('history: legacy user lookup error', legacyError);
      return NextResponse.json({ data: [], error: 'Legacy user lookup failed' }, { status: 500 });
    }

    if (!legacyUser) {
      // No legacy Meera data for this email
      return NextResponse.json({ data: [], error: null }, { status: 200 });
    }

    const legacyUserId = legacyUser.id as string;

    // 3) Pagination
    const { searchParams } = new URL(req.url);
    const page = Number(searchParams.get('page') ?? '1');
    const pageSize = 50;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    // 4) Fetch legacy messages for this user_id
    const { data: rows, error: messagesError } = await supabase
      .from('messages')
      .select('*')
      .eq('user_id', legacyUserId)
      .order('timestamp', { ascending: true })
      .range(from, to);

    if (messagesError) {
      console.error('history: messages error', messagesError);
      return NextResponse.json({ data: [], error: 'Failed to load messages' }, { status: 500 });
    }

    // 5) Map into ChatMessageFromServer[] (no user_id field, frontend does not need it)
    const mapped: ChatMessageFromServer[] =
      ((rows as LegacyMessageRow[] | null) ?? []).map(
        (row: LegacyMessageRow): ChatMessageFromServer => ({
          message_id: row.message_id,
          content_type: row.content_type === 'assistant' ? 'assistant' : 'user',
          content: row.content,
          timestamp: row.timestamp,
          session_id: row.session_id ?? undefined,
          is_call: Boolean(row.is_call),
          attachments: [],
          failed: false,
          finish_reason: null,
        }),
      );

    return NextResponse.json({ data: mapped, error: null }, { status: 200 });
  } catch (err) {
    console.error('history: unexpected error', err);
    return NextResponse.json({ data: [], error: 'Server error' }, { status: 500 });
  }
}
