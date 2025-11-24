import NextAuth, { type AuthOptions } from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import GoogleProvider from 'next-auth/providers/google';
import axios from 'axios';
import { jwtDecode } from 'jwt-decode';
import { sendAuthErrorToSlack, sendSuccessToSlack } from '@/lib/slackService';

// Force Node runtime (avoids edge-cookie / axios issues)
export const runtime = 'nodejs';

declare module 'next-auth/jwt' {
  interface JWT {
    access_token?: string;
    refresh_token?: string;
    access_token_expires_at?: number;
    error?: string;
  }
}

declare module 'next-auth' {
  interface Session {
    access_token?: string;
    refresh_token?: string;
    error?: string;
  }
}

interface JWTPayload {
  exp: number;
}

interface SignupResponse {
  access_token: string;
  refresh_token: string;
}

const authOptions: AuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      authorization: {
        params: {
          prompt: 'select_account',
          access_type: 'offline',
          response_type: 'code',
        },
      },
    }),
  ],

  secret: process.env.NEXTAUTH_SECRET,
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60,
  },

  pages: {
    signIn: '/sign-in',
    error: '/sign-in',
  },

  callbacks: {
    async redirect({ url, baseUrl }) {
      if (url.startsWith('/')) return `${baseUrl}${url}`;
      try {
        const u = new URL(url);
        if (u.origin === baseUrl) return url;
      } catch {
        // ignore
      }
      return baseUrl;
    },

    async signIn({ account, profile }) {
      return account?.provider === 'google' && !!profile?.email;
    },

    async jwt({ token, account, user }) {
      // First login with Google
      if (account?.id_token && user) {
        return await exchangeGoogleToken(account.id_token, token);
      }

      // Token still valid
      if (
        token.access_token &&
        token.access_token_expires_at &&
        Date.now() < token.access_token_expires_at
      ) {
        return token;
      }

      // Refresh if possible
      if (token.refresh_token) {
        return await refreshAccessToken(token);
      }

      return token;
    },

    async session({ session, token }) {
      session.access_token = token.access_token;
      session.refresh_token = token.refresh_token;
      session.error = token.error;
      return session;
    },
  },

  debug: process.env.NODE_ENV === 'development',
};

async function exchangeGoogleToken(googleToken: string, token: JWT): Promise<JWT> {
  try {
    const base = process.env.NEXT_PUBLIC_BACKEND_URL;
    if (!base) throw new Error('NEXT_PUBLIC_BACKEND_URL is missing');

    const response = await axios.post<SignupResponse>(
      `${base}/user/signup`,
      { google_token: googleToken },
      {
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const { access_token, refresh_token } = response.data;
    const expiresAt = getTokenExpiry(access_token);

    return {
      ...token,
      access_token,
      refresh_token,
      access_token_expires_at: expiresAt,
      error: undefined,
    };
  } catch (err: unknown) {
    console.error('Error exchanging Google token:', err);
    safeSlackAuthError('Error exchanging Google token', err);
    return { ...token, error: 'TokenExchangeError' };
  }
}

async function refreshAccessToken(token: JWT): Promise<JWT> {
  try {
    if (!token.refresh_token) throw new Error('No refresh token available');

    const base = process.env.NEXT_PUBLIC_BACKEND_URL;
    if (!base) throw new Error('NEXT_PUBLIC_BACKEND_URL is missing');

    const response = await axios.post(
      `${base}/user/refresh-token`,
      {},
      {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token.refresh_token}`,
        },
      }
    );

    const { access_token, refresh_token } = response.data as SignupResponse;
    const expiresAt = getTokenExpiry(access_token);

    return {
      ...token,
      access_token,
      refresh_token: refresh_token || token.refresh_token,
      access_token_expires_at: expiresAt,
      error: undefined,
    };
  } catch (err: unknown) {
    console.error('Error refreshing access token:', err);
    safeSlackSuccess('Error refreshing access token', err);
    return {
      ...token,
      error: 'RefreshTokenError',
      access_token: undefined,
      refresh_token: undefined,
      access_token_expires_at: undefined,
    };
  }
}

function getTokenExpiry(token: string): number | undefined {
  try {
    const decoded = jwtDecode<JWTPayload>(token);
    return decoded.exp * 1000;
  } catch (err) {
    console.error('Error decoding JWT token:', err);
    return undefined;
  }
}

function safeSlackAuthError(message: string, err: unknown) {
  try {
    sendAuthErrorToSlack({
      message,
      errorResponse: serializeError(err),
    });
  } catch (e) {
    console.error('Slack error logging failed:', e);
  }
}

function safeSlackSuccess(message: string, err: unknown) {
  try {
    sendSuccessToSlack({
      message,
      endpoint: '/user/refresh-token',
      successResponse: serializeError(err),
    });
  } catch (e) {
    console.error('Slack success logging failed:', e);
  }
}

function serializeError(err: unknown): Record<string, unknown> {
  if (axios.isAxiosError(err)) {
    return {
      message: err.message,
      status: err.response?.status,
      data: err.response?.data,
    };
  }
  if (err instanceof Error) {
    return { message: err.message, stack: err.stack };
  }
  return { err };
}

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
