'use client';

export interface GuestTokenResponse {
  guest_token: string;
}

export const guestService = {
  // keep the same signature the page expects
  async getGuestToken(_referralId?: string): Promise<GuestTokenResponse | null> {
    // Mark parameter as intentionally unused so ESLint is happy
    void _referralId;

    // Only run in the browser
    if (typeof window === 'undefined') {
      return null;
    }

    const existing = window.localStorage.getItem('guest_token');
    if (existing) {
      return { guest_token: existing };
    }

    const token =
      typeof window.crypto !== 'undefined' &&
      typeof window.crypto.randomUUID === 'function'
        ? window.crypto.randomUUID()
        : `guest-${Math.random().toString(36).slice(2)}`;

    window.localStorage.setItem('guest_token', token);

    return { guest_token: token };
  },

  async createGuestToken(referralId?: string): Promise<GuestTokenResponse | null> {
    return this.getGuestToken(referralId);
  },
};
