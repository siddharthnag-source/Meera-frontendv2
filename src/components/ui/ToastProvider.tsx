'use client';

import type { ToastType } from '@/types/components';
import React, { createContext, ReactNode, useCallback, useContext, useState } from 'react';

interface ToastState {
  id: string;
  message: string;
  type?: ToastType;
}

export interface ShowToastOptions {
  type?: ToastType;
  duration?: number;
  position: string;
  persist?: boolean;
}

interface ToastContextProps {
  showToast: (message: string, options: ShowToastOptions) => void;
  clearToasts: (position: string) => void;
  toasts: Record<string, ToastState[]>;
}

const ToastContext = createContext<ToastContextProps | undefined>(undefined);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<Record<string, ToastState[]>>({});

  const showToast = useCallback(
    (message: string, { type = 'info', duration = 5000, position, persist = false }: ShowToastOptions) => {
      const id = Date.now().toString() + Math.random().toString();
      const newToast: ToastState = { id, message, type };

      setToasts((prev) => ({
        ...prev,
        [position]: [...(prev[position] || []), newToast],
      }));

      if (!persist) {
        setTimeout(() => {
          setToasts((prev) => {
            const newToastsForPosition = (prev[position] || []).filter((t) => t.id !== id);
            return {
              ...prev,
              [position]: newToastsForPosition,
            };
          });
        }, duration);
      }
    },
    [],
  );

  const clearToasts = useCallback((position: string) => {
    setToasts((prev) => {
      if (!prev[position] || prev[position].length === 0) return prev;
      return {
        ...prev,
        [position]: [],
      };
    });
  }, []);

  return <ToastContext.Provider value={{ showToast, clearToasts, toasts }}>{children}</ToastContext.Provider>;
};
