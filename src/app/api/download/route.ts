import { NextRequest, NextResponse } from 'next/server';

const DOWNLOAD_TIMEOUT_MS = 10_000;

const SUPABASE_HOST = (() => {
  const urlValue = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!urlValue) return null;
  try {
    return new URL(urlValue).host.toLowerCase();
  } catch {
    return null;
  }
})();

const ALLOWED_DOWNLOAD_HOSTS = new Set(
  (process.env.DOWNLOAD_PROXY_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);

if (SUPABASE_HOST) {
  ALLOWED_DOWNLOAD_HOSTS.add(SUPABASE_HOST);
}

function sanitizeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'download';
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const fileUrl = searchParams.get('url');

  if (!fileUrl) {
    return NextResponse.json({ error: 'URL parameter is required' }, { status: 400 });
  }

  if (ALLOWED_DOWNLOAD_HOSTS.size === 0) {
    return NextResponse.json(
      { error: 'Download proxy is not configured for any allowed hosts' },
      { status: 500 },
    );
  }

  try {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(fileUrl);
    } catch {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
    }

    if (parsedUrl.protocol !== 'https:') {
      return NextResponse.json({ error: 'Only HTTPS URLs are allowed' }, { status: 400 });
    }

    if (!ALLOWED_DOWNLOAD_HOSTS.has(parsedUrl.host.toLowerCase())) {
      return NextResponse.json({ error: 'Host is not allowed' }, { status: 403 });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

    const response = await fetch(parsedUrl.toString(), {
      signal: controller.signal,
      redirect: 'error',
      cache: 'no-store',
    }).finally(() => clearTimeout(timeoutId));

    if (!response.ok) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const rawName = decodeURIComponent(parsedUrl.pathname.split('/').pop() || 'download');
    const filename = sanitizeFilename(rawName);
    const contentLengthHeader = response.headers.get('Content-Length');
    const hasValidContentLength =
      typeof contentLengthHeader === 'string' && /^[0-9]+$/.test(contentLengthHeader);

    return new NextResponse(response.body, {
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename}"`,
        ...(hasValidContentLength ? { 'Content-Length': contentLengthHeader } : {}),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Download proxy error:', error);
    return NextResponse.json({ error: 'Download failed' }, { status: 500 });
  }
}
