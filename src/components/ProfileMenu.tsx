'use client';

import React from 'react';
import { FaCrown } from 'react-icons/fa6';
import { FiLogOut, FiSettings } from 'react-icons/fi';

interface ProfileMenuProps {
  isOpen: boolean;
  onClose: () => void;
  tokensConsumed?: string | null;
  onUpgrade: () => void;
  onOpenSettings: () => void;
  onSignOut: () => void;
  anchor?: 'top-left' | 'sidebar-bottom';
}

export const ProfileMenu: React.FC<ProfileMenuProps> = ({
  isOpen,
  onClose,
  tokensConsumed,
  onUpgrade,
  onOpenSettings,
  onSignOut,
  anchor = 'sidebar-bottom',
}) => {
  if (!isOpen) return null;

  const tokenText = tokensConsumed?.trim() || '0';

  const menuPositionClass =
    anchor === 'top-left' ? 'top-16 left-4 w-[min(92vw,340px)]' : 'bottom-16 left-2 w-[244px]';

  return (
    <div className="fixed inset-0 z-50">
      <button
        onClick={onClose}
        className="absolute inset-0 bg-primary/5"
        aria-label="Close profile menu backdrop"
      />

      <section className={`absolute ${menuPositionClass} rounded-xl border border-primary/20 bg-background shadow-xl`}>
        <div className="p-3 border-b border-primary/15">
          <button
            onClick={onUpgrade}
            className="w-full flex items-center justify-center gap-2 rounded-lg border border-primary/20 bg-background px-3 py-2.5 text-sm text-primary hover:bg-primary/10 transition-colors"
          >
            <FaCrown size={14} />
            <span className="font-medium">Upgrade to Pro</span>
          </button>
        </div>

        <div className="px-3 pt-2.5 pb-3 border-b border-primary/15">
          <p className="text-[11px] uppercase tracking-[0.12em] text-primary/60">Tokens consumed</p>
          <div className="mt-1.5 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5">
            <p className="text-base font-medium text-primary">{tokenText}</p>
          </div>
        </div>

        <footer className="p-2 space-y-1">
          <button
            onClick={onOpenSettings}
            className="w-full rounded-lg px-2.5 py-2 text-left text-sm text-primary hover:bg-primary/10 transition-colors flex items-center gap-2"
          >
            <FiSettings size={16} />
            <span>Settings</span>
          </button>
          <button
            onClick={onSignOut}
            className="w-full rounded-lg px-2.5 py-2 text-left text-sm text-primary hover:bg-primary/10 transition-colors flex items-center gap-2"
          >
            <FiLogOut size={16} />
            <span>Sign out</span>
          </button>
        </footer>
      </section>
    </div>
  );
};
