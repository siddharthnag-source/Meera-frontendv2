import { sendErrorToSlack } from '@/lib/slackService';
import { supabase } from '@/lib/supabaseClient';
import type { ApiErrorResponse } from '@/types/api';
import axios, { AxiosRequestConfig, AxiosError } from 'axios';
import axiosRetry from 'axios-retry';
import { API_BASE_URL } from './config';

// 1. Enhanced Error Handling Classes
class NetworkError extends Error {
  constructor(message = 'Network error. Please check your connection.') {
    super(message);
    this.name = 'NetworkError';
  }
}

// Create axios instance with default config
export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 120000, // 2-minute timeout
  withCredentials: true,
});

// 2. Configure axios-retry with exponential backoff
axiosRetry(apiClient, {
  retries: 3,
  retryDelay: (retryCount) => Math.pow(2, retryCount) * 1000, // 1s, 2s, 4s
  retryCondition: (error) => {
    return (
      axiosRetry.isNetworkError(error) ||
      error.response?.status === 429 ||
      (error.response?.status !== undefined && error.response.status >= 500)
    );
  },
  onRetry: (retryCount, error) => {
    console.warn(`Retrying API request ${retryCount}/3: ${error.config?.url}`);
  },
});

// 3. Request interceptor to add authorization header
apiClient.interceptors.request.use(async (config) => {
  const extendedConfig = config as typeof config & { noAuth?: boolean };
  if (extendedConfig.noAuth) {
    return config;
  }

  try {
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      console.error('Supabase session retrieval error:', sessionError);
    }

    if (data.session?.access_token) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${data.session.access_token}`;
      return config;
    }

    if (typeof window !== 'undefined') {
      const guestToken = localStorage.getItem('guest_token');
      if (guestToken) {
        config.headers = config.headers || {};
        config.headers.Authorization = `Bearer ${guestToken}`;
      }
    }

    return config;
  } catch (error) {
    console.error('Session retrieval error:', error);

    if (typeof window !== 'undefined') {
      const guestToken = localStorage.getItem('guest_token');
      if (guestToken) {
        config.headers = config.headers || {};
        config.headers.Authorization = `Bearer ${guestToken}`;
        return config;
      }
    }

    throw new NetworkError();
  }
});

// Helper function to check if this is the final retry attempt
const isFinalRetryAttempt = (error: AxiosError): boolean => {
  const axiosError = error as AxiosError & { config: { 'axios-retry'?: { retryCount: number } } };
  return (axiosError.config?.['axios-retry']?.retryCount ?? 0) >= 3 || !axiosRetry.isRetryableError(error);
};

// 4. Response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    let userEmail: string | undefined;
    try {
      const { data } = await supabase.auth.getSession();
      userEmail = data.session?.user?.email || undefined;
    } catch (sessionError) {
      console.error('Supabase session lookup failed during API error handling:', sessionError);
    }
    const guestToken = typeof window !== 'undefined' ? localStorage.getItem('guest_token') : null;

    const errorResponse: ApiErrorResponse = {
      message: 'Something went wrong. Please try again.',
      status: 0,
      code: '',
      data: null,
    };

    // Only send Slack notifications on final failure (after all retries) and exclude 401s
    const shouldNotifySlack = isFinalRetryAttempt(error) && error.response?.status !== 401;

    if (error.response) {
      const { status, data, config } = error.response;
      errorResponse.status = status;

      const errorMessages: Record<number, string> = {
        401: 'Authentication failed. Please log in again.',
        500: 'Too many people are using our AI right now. Please try again later.',
      };
      errorResponse.message = errorMessages[status] ?? 'An unexpected error occurred. Please try again.';

      errorResponse.code = data?.code || errorResponse.code;
      errorResponse.data = data?.data;

      // Only log non-401 errors to Slack on final attempt
      if (shouldNotifySlack) {
        sendErrorToSlack({
          message: `API Error: ${config.method?.toUpperCase()} ${config.url}`,
          endpoint: `${config.method?.toUpperCase()} ${config.url}`,
          requestPayload: config.data,
          errorResponse: data,
          status,
          userEmail,
          guestToken,
        });
      }
    } else if (error.request) {
      errorResponse.message = 'Network error. Please check your connection.';
      errorResponse.code = 'NETWORK_ERROR';
      errorResponse.status = 0;

      // Only send network errors on final attempt
      if (shouldNotifySlack) {
        sendErrorToSlack({
          message: 'Network Error',
          endpoint: `${error.config?.method?.toUpperCase() || 'UNKNOWN'} ${error.config?.url || 'UNKNOWN'}`,
          requestPayload: error.config?.data,
          errorResponse: 'Request failed without a response.',
          status: 0,
          userEmail,
          guestToken,
        });
      }
    } else {
      errorResponse.message = error.message || 'A client-side error occurred while preparing the request.';
      errorResponse.code = 'CLIENT_REQUEST_ERROR';

      // Only send client errors on final attempt
      if (shouldNotifySlack) {
        sendErrorToSlack({
          message: 'Client-Side Request Error',
          endpoint: `${error.config?.method?.toUpperCase() || 'UNKNOWN'} ${error.config?.url || 'UNKNOWN'}`,
          requestPayload: error.config?.data,
          errorResponse: error.message,
          status: -1,
          userEmail,
          guestToken,
        });
      }
    }

    // Handle 401 errors (sign out user) but don't spam Slack
    if (errorResponse.status === 401) {
      if (typeof window !== 'undefined') {
        localStorage.clear();
        try {
          await supabase.auth.signOut();
        } catch (signOutError) {
          console.error('Supabase sign-out failed:', signOutError);
        }
        window.location.href = '/sign-in';
      }
    }

    return Promise.reject(errorResponse);
  },
);

// 5. Type-safe API client methods with optional noAuth flag
export const api = {
  get: <T>(url: string, config?: AxiosRequestConfig & { noAuth?: boolean }) =>
    apiClient.get<T>(url, config).then((res) => res.data),
  post: <T>(url: string, data?: unknown, config?: AxiosRequestConfig & { noAuth?: boolean }) =>
    apiClient.post<T>(url, data, config).then((res) => res.data),
  put: <T>(url: string, data?: unknown, config?: AxiosRequestConfig & { noAuth?: boolean }) =>
    apiClient.put<T>(url, data, config).then((res) => res.data),
  delete: <T>(url: string, config?: AxiosRequestConfig & { noAuth?: boolean }) =>
    apiClient.delete<T>(url, config).then((res) => res.data),
};
