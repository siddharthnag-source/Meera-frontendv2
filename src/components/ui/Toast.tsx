import { premiumTransitions } from '@/lib/motion';
import type { ToastTypeStyles } from '@/types/components';
import { AnimatePresence, motion } from 'framer-motion';
import React from 'react';
import { useToast } from './ToastProvider';

export interface ToastProps {
  position: string;
  className?: string;
}

export const Toast = ({ position, className }: ToastProps) => {
  const { toasts } = useToast();
  const toastsForPosition = toasts[position] || [];

  if (toastsForPosition.length === 0) {
    return null;
  }

  const typeStyles: ToastTypeStyles = {
    success: 'border-primary',
    error: 'border-red-500',
    info: 'border-primary',
    warning: 'border-yellow-500',
  };

  const positionStyles: Record<string, string> = {
    conversation: 'fixed top-[20px] left-1/2 -translate-x-1/2 z-[9999] w-[min(92vw,560px)]',
  };

  const containerClassName = `flex flex-col space-y-2 ${positionStyles[position] ?? ''} ${className ?? ''}`.trim();

  return (
    <div className={containerClassName}>
      <AnimatePresence initial={false}>
        {toastsForPosition.map((toastData) => (
          <motion.div
            key={toastData.id}
            layout
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={premiumTransitions.pop}
            className={`px-4 py-2 rounded-md border bg-[#E7E5DA] backdrop-blur-sm shadow-md text-primary break-words ${
              typeStyles[toastData.type || 'info']
            }`}
          >
            <span className="text-sm">{toastData.message}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};
