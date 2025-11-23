import axios from "axios";
import { jwtDecode } from "jwt-decode";
import NextAuth, { type AuthOptions } from "next-auth";
import type { JWT } from "next-auth/jwt";
import GoogleProvider from "next-auth/providers/google";
import { cookies } from "next/headers";
import { sendAuthErrorToSlack, sendSuccessToSlack } from "@/lib/slackService";

declare module "next-auth/jwt" {
  interface JWT {
    access_token?: string;
    refresh_token?: string;
    access_token_expires_at?: number;
    error?: string;
  }
}

declare module "next-auth" {
  interface Session {
    access_token?: string;
    refresh_token?: string;
    error?: string;
  }
  interface Account {
    callbackUrl?: string;
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
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          prompt: "select_account",
          access_type: "offline",
          response_type: "code",
        },
      },
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60,
  },

  // keep this as "/" since your real sign-in UI is at root
  pages: {
    signIn: "/",
    error: "/",
  },

  callbacks: {
    async redirect({ url, baseUrl }) {
      if (url.startsWith("/")) return `${baseUrl}${url}`;

      try {
        const urlObj = new URL(url);
        if (urlObj.origin === baseUrl) return url;
      } catch {
        return baseUrl;
      }

      return baseUrl;
    },

    async signIn({ account, profile }) {
      return account?.provider === "google" && !!profile?.email;
    },

    async jwt({ token, account, user }) {
      // first login
      if (user && account?.id_token) {
        let referralId: string | null = null;
        let guestToken: string | null = null;

        try {
          const cookieStore = await cookies();
          referralId = cookieStore.get("referral_id")?.value ?? null;
          guestToken = cookieStore.get("guest_token")?.value ?? null;
          // Do not delete cookies here. Next 15 cookies() is readonly in many contexts.
        } catch (e) {
          console.error("Error reading cookies:", e);
        }

        return exchangeGoogleToken(account.id_token, token, referralId, guestToken);
      }

      // reuse valid access token
      if (
        token.access_token &&
        token.access_token_expires_at &&
        Date.now() < token.access_token_expires_at
      ) {
        return token;
      }

      // refresh if expired
      if (token.access_token && token.access_token_expires_at) {
        return refreshAccessToken(token);
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
};

async function exchangeGoogleToken(
  googleToken: string,
  token: JWT,
  referralId?: string | null,
  guestToken?: string | null
) {
  try {
    const payload: Record<string, string> = {
      google_token: googleToken,
    };

    if (referralId) payload.referral_id = referralId;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (guestToken) headers.Authorization = `Bearer ${guestToken}`;

    const response = await axios.post<SignupResponse>(
      `${process.env.NEXT_PUBLIC_BACKEND_URL}/user/signup`,
      payload,
      { timeout: 10000, headers }
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
  } catch (e) {
    console.error("Error exchanging Google token:", e);
    sendAuthErrorToSlack({
      message: "Error exchanging Google token",
      errorResponse: e,
      guestToken,
    });
    return {
      ...token,
      error: "TokenExchangeError",
    };
  }
}

async function refreshAccessToken(token: JWT) {
  try {
    if (!token.refresh_token) throw new Error("No refresh token available");

    const response = await axios.post(
      `${process.env.NEXT_PUBLIC_BACKEND_URL}/user/refresh-token`,
      {},
      {
        timeout: 10000,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token.refresh_token}`,
        },
      }
    );

    const { access_token, refresh_token } = response.data;
    const expiresAt = getTokenExpiry(access_token);

    return {
      ...token,
      access_token,
      refresh_token: refresh_token || token.refresh_token,
      access_token_expires_at: expiresAt,
      error: undefined,
    };
  } catch (e) {
    console.error("Error refreshing access token:", e);
    sendSuccessToSlack({
      message: "Error refreshing access token (refresh token expired)",
      endpoint: "/user/refresh-token",
      successResponse: e,
    });
    return {
      ...token,
      error: "RefreshTokenError",
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
  } catch (e) {
    console.error("Error decoding JWT token:", e);
    return undefined;
  }
}

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
