'use client';

// Front-only guest token helper that does NOT call any backend.
// It just ensures there is some guest_token in localStorage.
export const guestService = {
  async getGuestToken(): Promise<void> {
    // On the server we do nothing, the real work happens in the browser
    if (typeof window === 'undefined') return;

    const existing = window.localStorage.getItem('guest_token');
    if (existing) return;

    // Generate a simple random token
    const token =
      typeof window.crypto !== 'undefined' &&
      typeof window.crypto.randomUUID === 'function'
        ? window.crypto.randomUUID()
        : `guest-${Math.random().toString(36).slice(2)}`;

    window.localStorage.setItem('guest_token', token);
  },

  // Optional alias, in case any code uses a different name
  async createGuestToken(): Promise<void> {
    return this.getGuestToken();
  },
};
