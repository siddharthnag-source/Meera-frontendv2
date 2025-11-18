// src/app/api/history/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/auth-helpers-nextjs';
import { getOrCreateLegacyUserId } from '@/lib/legacyUser';

const PAGE_SIZE = 20;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const page = Number(searchParams.get('page') ?? '1');
    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    // 1) Authenticated Supabase client bound to cookies
    const cookieStore = cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
          set() {
            // no-op for API route
          },
          remove() {
            // no-op for API route
          },
        },
      },
    );

    // 2) Current Supabase auth user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      console.error('history route: getUser error', userError);
      return NextResponse.json({ data: [], error: 'Auth error' }, { status: 401 });
    }

    if (!user || !user.email) {
      return NextResponse.json({ data: [], error: 'Not authenticated' }, { status: 401 });
    }

    const email = user.email;
    const name = (user.user_metadata as { name?: string })?.name;

    // 3) Map email -> legacy `users.id`
    const legacyUserId = await getOrCreateLegacyUserId(email, name);

    // 4) Load legacy messages
    const { data, error } = await supabase
      .from('messages')
      .select(
        'message_id, user_id, content_type, content, timestamp, session_id, is_call, model, system_prompt, google_search, as_memory',
      )
      .eq('user_id', legacyUserId)
      .order('timestamp', { ascending: true })
      .range(from, to);

    if (error) {
      console.error('history route: messages error', error);
      return NextResponse.json({ data: [], error: 'Failed to load messages' }, { status: 500 });
    }

    const rows = data ?? [];

    // 5) Adapt to ChatMessageFromServer shape
    const mapped = rows.map((row) => ({
      ...row,
      attachments: [],
      failed: false,
      finish_reason: null,
    }));

    return NextResponse.json({ data: mapped });
  } catch (err) {
    console.error('history route: unexpected error', err);
    return NextResponse.json({ data: [], error: 'Unexpected error' }, { status: 500 });
  }
}
