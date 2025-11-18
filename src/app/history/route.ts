import { NextRequest, NextResponse } from 'next/server';
import { ChatMessageFromServer } from '@/types/chat';

type HistoryResponse = {
  message: string;
  data: ChatMessageFromServer[];
};

// Temporary stub: history is loaded directly from Supabase on the client.
// This route just returns an empty list so builds pass cleanly.
export async function GET(
  request: NextRequest,
): Promise<NextResponse<HistoryResponse>> {
  // mark `request` as used so ESLint is happy
  void request;

  const body: HistoryResponse = {
    message: 'ok',
    data: [],
  };

  return NextResponse.json(body);
}
