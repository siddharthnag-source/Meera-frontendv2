import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';

type LegacyMessageRow = {
  message_id: string;
  user_id: string;
  content_type: 'user' | 'assistant';
  content: string;
  timestamp: string;
  session_id: string | null;
  is_call: boolean | null;
  model: string | null;
  finish_reason: string | null;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const page = parseInt(url.searchParams.get('page') ?? '1', 10);
  const pageSize = 20;

  const supabase = createRouteHandlerClient({ cookies });

  // 1) Get logged-in Supabase auth user
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user || !user.email) {
    return NextResponse.json(
      { message: 'unauthorized', data: [] },
      { status: 401 },
    );
  }

  const email = user.email;

  // 2) Find existing legacy user by email (this connects to old data)
  const { data: existingUsers, error: findError } = await supabase
    .from('users')
    .select('id, email, name')
    .eq('email', email)
    .limit(1);

  if (findError) {
    console.error('history: error finding user by email', findError);
    return NextResponse.json(
      { message: 'error', data: [] },
      { status: 500 },
    );
  }

  let appUserId: string;

  if (existingUsers && existingUsers.length > 0) {
    // Use legacy user id so we see old messages
    appUserId = existingUsers[0].id as string;
  } else {
    // No legacy row → create one now, tied to this email
    const { data: inserted, error: insertError } = await supabase
      .from('users')
      .insert({
        id: user.id, // use auth id for new people
        email,
        name:
          (user.user_metadata && (user.user_metadata.full_name as string)) ||
          email,
      })
      .select('id')
      .single();

    if (insertError || !inserted) {
      console.error('history: error inserting user', insertError);
      return NextResponse.json(
        { message: 'error', data: [] },
        { status: 500 },
      );
    }

    appUserId = inserted.id as string;
  }

  // 3) Load messages for that app user id
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data: rows, error: msgError } = await supabase
    .from('messages')
    .select(
      'message_id, user_id, content_type, content, timestamp, session_id, is_call, model, finish_reason',
    )
    .eq('user_id', appUserId)
    .order('timestamp', { ascending: true })
    .range(from, to);

  if (msgError) {
    console.error('history: error loading messages', msgError);
    return NextResponse.json(
      { message: 'error', data: [] },
      { status: 500 },
    );
  }

  const mapped = (rows ?? []).map(
    (row: LegacyMessageRow): LegacyMessageRow => ({
      message_id: row.message_id,
      user_id: row.user_id,
      content_type: row.content_type,
      content: row.content,
      timestamp: row.timestamp,
      session_id: row.session_id,
      is_call: row.is_call ?? false,
      model: row.model,
      finish_reason: row.finish_reason,
    }),
  );

  return NextResponse.json(
    { message: 'ok', data: mapped },
    { status: 200 },
  );
}
