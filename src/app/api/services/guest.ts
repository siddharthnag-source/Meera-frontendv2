'use client';

export interface GuestTokenResponse {
  guest_token: string;
}

export const guestService = {
  // Keep the same signature the page expects: optional referralId, returns an object
  async getGuestToken(_referralId?: string): Promise<GuestTokenResponse | null> {
    // Only run in the browser
    if (typeof window === 'undefined') {
      return null;
    }

    const existing = window.localStorage.getItem('guest_token');
    if (existing) {
      return { guest_token: existing };
    }

    // Generate a simple random guest token
    const token =
      typeof window.crypto !== 'undefined' &&
      typeof window.crypto.randomUUID === 'function'
        ? window.crypto.randomUUID()
        : `guest-${Math.random().toString(36).slice(2)}`;

    window.localStorage.setItem('guest_token', token);

    return { guest_token: token };
  },

  // Alias, in case anything uses createGuestToken
  async createGuestToken(referralId?: string): Promise<GuestTokenResponse | null> {
    return this.getGuestToken(referralId);
  },
};
