'use client';

import { AnimatePresence, motion } from 'framer-motion';
import Image from 'next/image';
import { MdKeyboardArrowRight } from 'react-icons/md';

interface SupportPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const TRANSITIONS = {
  backdrop: { duration: 0.2 },
  panel: {
    type: 'tween' as const,
    duration: 0.3,
  },
};

export const SupportPanel = ({ isOpen, onClose }: SupportPanelProps) => {
  const supportItems: Array<{ label: string; onClick: () => void }> = [
    {
      label: 'Help & Support',
      onClick: () => {
        window.location.href = 'mailto:siddharth.nag@himeera.com';
      },
    },
    {
      label: 'Terms of Service',
      onClick: () => {
        window.open('/terms', '_blank', 'noopener,noreferrer');
      },
    },
    {
      label: 'Privacy Policy',
      onClick: () => {
        window.open('/privacy', '_blank', 'noopener,noreferrer');
      },
    },
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={TRANSITIONS.backdrop}
            onClick={onClose}
            className="fixed inset-0 bg-black/30 backdrop-blur-sm z-[50]"
          />

          <motion.div
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={TRANSITIONS.panel}
            className="fixed z-[50] bg-background flex flex-col inset-0 md:inset-auto md:top-0 md:left-0 md:bottom-0 w-full xl:w-[30%] md:border-r md:border-primary/20"
          >
            <div className="flex flex-col h-full overflow-hidden">
              <div className="px-4 sm:px-6 md:px-10 py-4 sm:py-6 flex items-center justify-between">
                <h3 className="text-2xl sm:text-3xl font-serif italic text-primary">Settings</h3>
                <button
                  onClick={onClose}
                  className="rounded-full flex items-center justify-center bg-transparent border border-2 border-secondary/30 transition-colors duration-200 p-2 cursor-pointer w-10 h-10"
                  aria-label="Close settings"
                >
                  <Image src="/icons/cross.svg" alt="Close" width={24} height={24} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto hide-scrollbar px-4 sm:px-6 md:px-10 pb-8">
                <div className="rounded-xl border border-primary/20 bg-background overflow-hidden">
                  {supportItems.map((item) => (
                    <button
                      key={item.label}
                      className="w-full flex items-center justify-between px-4 sm:px-5 py-3 bg-background hover:bg-primary/5 transition-colors cursor-pointer"
                      onClick={item.onClick}
                    >
                      <span className="text-[15px] text-primary">{item.label}</span>
                      <MdKeyboardArrowRight className="w-5 h-5 sm:w-6 sm:h-6 text-primary/45" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
