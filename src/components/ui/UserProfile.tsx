'use client';

import { Dialog } from '@/components/ui/Dialog';
import { usePricingModal } from '@/contexts/PricingModalContext';
// import { usePWAInstall } from '@/contexts/PWAInstallContext';
import { useSubscriptionStatus } from '@/hooks/useSubscriptionStatus';
import { AnimatePresence, motion } from 'framer-motion';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { FaCrown } from 'react-icons/fa';
import { MdKeyboardArrowRight } from 'react-icons/md';

import { supabase } from '@/lib/supabaseClient';
import type { User } from '@supabase/supabase-js';

interface UserProfileProps {
  isOpen: boolean;
  onClose: () => void;
}

// Faster transitions for improved UX
const TRANSITIONS = {
  backdrop: { duration: 0.2 },
  slide: {
    type: 'tween' as const,
    duration: 0.2,
    ease: 'easeInOut',
  },
  panel: {
    type: 'tween' as const,
    duration: 0.3,
  },
};

export const UserProfile = ({ isOpen, onClose }: UserProfileProps) => {
  const searchParams = useSearchParams();
  const referralId = searchParams.get('referral_id');
  const { data: subscription } = useSubscriptionStatus();
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  // const { installPrompt, isStandalone, isIOS, handleInstallClick } = usePWAInstall();
  const { openModal } = usePricingModal();

  // Load Supabase user and listen for auth state changes
  useEffect(() => {
    const loadUser = async () => {
      const { data } = await supabase.auth.getUser();
      setUser(data.user ?? null);
    };

    loadUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Check if user is guest (has guest token but no Supabase user)
  const isGuest =
    typeof window !== 'undefined' && localStorage.getItem('guest_token') && !user;

  // Logout handler
  const handleLogout = async () => {
    try {
      onClose?.();
      localStorage.clear();
      await supabase.auth.signOut();
      window.location.href = '/sign-in';
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  // Handle Google sign in via Supabase
  const handleGoogleSignIn = () => {
    // Set cookies before initiating OAuth
    if (referralId) {
      document.cookie = `referral_id=${referralId}; path=/; max-age=3600; SameSite=Lax`;
    }

    const guestToken =
      typeof window !== 'undefined' ? localStorage.getItem('guest_token') : null;
    if (guestToken) {
      document.cookie = `guest_token=${guestToken}; path=/; max-age=3600; SameSite=Lax`;
    }

    supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: 'https://meera-frontendv2.vercel.app/auth/callback',
      },
    });
  };

  const handleUpgradeClick = () => {
    openModal('upgrade_button', true);
  };

  // Derive display name from Supabase user
  const displayName =
    (user?.user_metadata?.name as string) ||
    (user?.user_metadata?.full_name as string) ||
    user?.email ||
    '';

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={TRANSITIONS.backdrop}
              onClick={onClose}
              className="fixed inset-0 bg-black/30 backdrop-blur-sm z-[50]"
            />

            {/* Profile Panel */}
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={TRANSITIONS.panel}
              className="fixed z-[50] bg-background flex flex-col
                inset-0 
                md:inset-auto md:top-0 md:left-0 md:bottom-0 
                w-full xl:w-[30%]
                md:border-r md:border-primary/20"
            >
              <div className="flex flex-col h-full overflow-hidden">
                {/* Header */}
                <div className="px-4 sm:px-6 md:px-10 py-4 sm:py-6 flex items-center justify-between">
                  {/* Back button for mobile/tablet (left side) */}
                  <button
                    onClick={onClose}
                    className="rounded-full flex items-center justify-center bg-transparent border border-2 border-secondary/30 transition-colors duration-200 p-2 cursor-pointer w-10 h-10 md:hidden"
                    aria-label="Close profile"
                  >
                    <Image src="/icons/arrow-back.svg" alt="Back" width={24} height={24} />
                  </button>

                  {/* Close button for desktop (right side) */}
                  <button
                    onClick={onClose}
                    className="rounded-full flex items-center justify-center bg-transparent border border-2 border-secondary/30 transition-colors duration-200 p-2 cursor-pointer w-10 h-10 hidden md:block md:ml-auto"
                    aria-label="Close profile"
                  >
                    <Image src="/icons/cross.svg" alt="Close" width={24} height={24} />
                  </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto hide-scrollbar px-4 sm:px-6 md:px-10 py-4 sm:py-6 md:py-8">
                  <div className="flex flex-col gap-4 sm:gap-6">
                    {/* Welcome Header */}
                    <div>
                      <h3 className="text-2xl sm:text-3xl font-serif italic text-primary">
                        {isGuest
                          ? `Welcome to ${process.env.NEXT_PUBLIC_APP_NAME} OS`
                          : displayName || `Welcome to ${process.env.NEXT_PUBLIC_APP_NAME} OS`}
                      </h3>
                      {!isGuest && user?.email && (
                        <p className="text-sm text-primary/70 mt-1">{user.email}</p>
                      )}
                    </div>

                    {subscription?.plan_type === 'free_trial' && (
                      <div className="rounded-xl border border-primary/20 bg-background overflow-hidden">
                        {/* Available Talktime */}
                        <div className="w-full flex items-center justify-between px-4 sm:px-5 py-3">
                          <span className="text-[15px] text-primary">Available Talktime</span>
                          <span className="text-[15px] font-medium text-primary bg-primary/10 px-3 sm:px-4 py-1 rounded-md">
                            {Math.floor((subscription?.talktime_left ?? 0) / 3600)}h{' '}
                            {Math.floor(
                              ((subscription?.talktime_left ?? 0) % 3600) / 60,
                            )}
                            m
                          </span>
                        </div>

                        {/* Available Tokens */}
                        <div className="w-full flex items-center justify-between px-4 sm:px-5 py-3 ">
                          <span className="text-[15px] text-primary">Available Tokens</span>
                          <span className="text-[15px] font-medium text-primary bg-primary/10 px-3 sm:px-4 py-1 rounded-md">
                            {(subscription?.tokens_left ?? 0).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Support Group */}
                    <div className="rounded-xl border border-primary/20 bg-background overflow-hidden">
                      {[
                        {
                          label: 'Help & Support',
                          action: () =>
                            (window.location.href = 'mailto:siddharth.nag@himeera.com'),
                        },
                        {
                          label: 'Terms of Service',
                          action: () => window.open('/terms', '_blank'),
                        },
                        {
                          label: 'Privacy Policy',
                          action: () => window.open('/privacy', '_blank'),
                        },
                      ].map((item, index) => (
                        <button
                          key={index}
                          className="w-full flex items-center justify-between px-4 sm:px-5 py-3 bg-background hover:cursor-pointer"
                          onClick={item.action}
                        >
                          <span className="text-[15px] text-primary">{item.label}</span>
                          <div className="flex items-center justify-center">
                            <Image
                              src="/icons/arrow-right.svg"
                              alt="Go"
                              width={22}
                              height={20}
                              className="w-5 h-5 sm:w-6 sm:h-6"
                            />
                          </div>
                        </button>
                      ))}
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-col gap-3">
                      {/* Login/Logout Button */}
                      {user ? (
                        <div className="rounded-xl border border-primary/20 bg-background overflow-hidden">
                          <button
                            className="w-full flex items-center justify-between px-4 sm:px-5 py-3 sm:py-4 bg-background hover:cursor-pointer group"
                            onClick={() => setShowLogoutDialog(true)}
                          >
                            <span className="text-[15px] text-red-300 group-hover:text-red-500 transition-colors">
                              Logout
                            </span>
                            <div className="flex items-center justify-center">
                              <MdKeyboardArrowRight className="w-5 h-5 sm:w-6 sm:h-6 text-red-200 group-hover:text-red-400 transition-colors" />
                            </div>
                          </button>
                        </div>
                      ) : isGuest ? (
                        <div className="rounded-xl border border-primary/20 bg-background overflow-hidden">
                          <button
                            className="w-full flex items-center justify-center px-4 sm:px-5 py-3 sm:py-4 bg-background hover:bg-primary/10 hover:cursor-pointer"
                            onClick={handleGoogleSignIn}
                          >
                            <div className="flex items-center">
                              <Image
                                src="/images/google_logo.svg"
                                alt="Google"
                                width={20}
                                height={20}
                                className="mr-2"
                              />
                              <span className="text-[15px] text-primary">
                                Login with Google
                              </span>
                            </div>
                          </button>
                        </div>
                      ) : null}

                      {/* Upgrade to Pro Button */}
                      <div className="rounded-xl border border-primary/20 bg-background overflow-hidden">
                        {subscription?.plan_type === 'free_trial' ||
                        !(
                          !!subscription?.subscription_end_date &&
                          new Date(subscription.subscription_end_date) >= new Date()
                        ) ? (
                          <button
                            className="w-full flex items-center justify-center px-4 sm:px-5 py-3 sm:py-4 bg-background hover:bg-primary/10 hover:cursor-pointer"
                            onClick={handleUpgradeClick}
                          >
                            <div className="flex items-center">
                              <FaCrown className="w-4 h-4 mr-3" />
                              <span className="text-[15px] text-primary">
                                Upgrade to Pro
                              </span>
                            </div>
                          </button>
                        ) : (
                          <div className="w-full flex items-center justify-center px-4 sm:px-5 py-3 sm:py-4 bg-background hover:cursor-pointer">
                            <div className="flex items-center">
                              <FaCrown className="w-4 h-4 mr-3 text-yellow-400" />
                              <span className="text-[15px] text-primary">
                                Pro Activated
                              </span>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Install App Button */}
                      {/* {!isStandalone && (installPrompt || isIOS) && (
                        <div className="rounded-xl border border-primary/20 bg-background overflow-hidden">
                          <button
                            className="w-full flex items-center justify-center px-4 sm:px-5 py-3 sm:py-4 bg-background hover:bg-primary/10 hover:cursor-pointer"
                            onClick={handleInstallClick}
                          >
                            <div className="flex items-center">
                              <MdFileDownload className="w-5 h-5 mr-3" />
                              <span className="text-[15px] text-primary">Install App</span>
                            </div>
                          </button>
                        </div>
                      )} */}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Logout Confirmation Dialog */}
      {showLogoutDialog && (
        <Dialog
          isOpen={showLogoutDialog}
          onClose={() => setShowLogoutDialog(false)}
          title="Logout?"
          description="Are you sure you want to log out? You'll need to log in again to access your account."
          icon={
            <Image
              src="/images/logout.svg"
              alt="Logout"
              width={32}
              height={32}
              className="w-8 h-8"
            />
          }
          actions={{
            confirm: {
              label: 'Logout',
              onClick: handleLogout,
            },
            cancel: {
              label: 'Cancel',
              onClick: () => setShowLogoutDialog(false),
            },
          }}
        />
      )}
    </>
  );
};
