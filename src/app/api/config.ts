// API configuration
export const API_BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

export const API_ENDPOINTS = {
  AUTH: {
    GOOGLE_TOKEN: '/user/token',
    REFRESH_TOKEN: '/user/refresh-token',
  },
  PAYMENT: {
    CREATE: '/payment',
    VERIFY: '/payment/verify',
    SUBSCRIPTION_STATUS: '/user/balance',
    DEDUCT_TALKTIME: '/user/balance',
  },
  CHAT: {
    HISTORY: '/chat/',
    MESSAGE: '/chat/message',
  },
  CALL: {
    SAVE_INTERACTION: '/call/save-interaction',
  },
  TRACKING: {
    MODAL: '/tracking/modal',
  },
} as const;
