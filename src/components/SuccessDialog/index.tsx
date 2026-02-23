'use client';

import { premiumTransitions } from '@/lib/motion';
import { AnimatePresence, motion } from 'framer-motion';
import Image from 'next/image';

interface SuccessDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  buttonText?: string;
}

export const SuccessDialog = ({
  isOpen,
  onClose,
  title = 'Please sign in to link your account!',
  description = `Congratulations! You've successfully upgraded to ${process.env.NEXT_PUBLIC_APP_NAME} OS Pro.`,
  buttonText = 'Explore!',
}: SuccessDialogProps) => {
  return (
    <AnimatePresence initial={false}>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={premiumTransitions.backdrop}
            className="fixed inset-0 bg-black/30 backdrop-blur-sm z-[200] flex items-center justify-center px-4  "
            onClick={onClose}
          >
            {/* Dialog */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={premiumTransitions.pop}
              className="w-full max-w-[320px] sm:max-w-[350px] bg-[#FDF6F1] rounded-lg overflow-hidden shadow-xl border border-primary"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Content */}
              <div className="p-6 text-center ">
                {/* Success Icon */}
                <div className="flex justify-center mb-4">
                  <Image src="/images/success.svg" alt="Success" width={40} height={40} className="w-10 h-10" />
                </div>

                {/* Title */}
                <h2 className="text-primary text-lg font-sans mb-2">{title}</h2>

                {/* Description */}
                <p className="text-xs text-primary/70 font-sans">{description}</p>
              </div>

              {/* Button */}
              <div className="border-t border-primary/20">
                <button
                  onClick={onClose}
                  className="w-full py-2 text-[#0C3C26] font-sans text-base hover:bg-gray-50 transition-colors"
                >
                  {buttonText}
                </button>
              </div>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
