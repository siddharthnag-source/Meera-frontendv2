'use client';

import type { SubscriptionData } from '@/types/subscription';
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
  subscriptionData?: SubscriptionData | null;
  isSubscriptionLoading?: boolean;
  anchor?: 'top-left' | 'sidebar-bottom';
}

export const ProfileMenu: React.FC<ProfileMenuProps> = ({
  isOpen,
  onClose,
  tokensConsumed,
  onUpgrade,
  onOpenSettings,
  onSignOut,
  subscriptionData,
  isSubscriptionLoading = false,
  anchor = 'sidebar-bottom',
}) => {
  if (!isOpen) return null;

  const tokenText = tokensConsumed?.trim() || '0';
  const subscriptionEndTime = subscriptionData?.subscription_end_date
    ? new Date(subscriptionData.subscription_end_date).getTime()
    : Number.NaN;
  const hasActivePro =
    subscriptionData?.plan_type === 'paid' &&
    Number.isFinite(subscriptionEndTime) &&
    subscriptionEndTime >= Date.now();
  const isPlanPending = isSubscriptionLoading && !subscriptionData;
  const isUpgradeDisabled = hasActivePro || isPlanPending;
  const upgradeLabel = isPlanPending ? 'Checking plan...' : hasActivePro ? 'Pro Activated' : 'Upgrade to Pro';

  const menuPositionClass =
    anchor === 'top-left'
      ? 'top-16 left-4 w-[min(92vw,340px)]'
      : 'bottom-16 left-2 w-[calc(84vw-16px)] max-w-[304px] md:w-[244px]';

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
            onClick={isUpgradeDisabled ? undefined : onUpgrade}
            disabled={isUpgradeDisabled}
            className={`w-full flex items-center justify-center gap-2 rounded-lg border border-primary/20 bg-background px-3 py-2.5 text-sm transition-colors ${
              isUpgradeDisabled ? 'cursor-default text-primary/80' : 'text-primary hover:bg-primary/10'
            }`}
          >
            <FaCrown size={14} className={hasActivePro ? 'text-yellow-500' : undefined} />
            <span className="font-medium">{upgradeLabel}</span>
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
