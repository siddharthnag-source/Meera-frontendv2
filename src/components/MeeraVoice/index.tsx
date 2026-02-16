'use client';

import { EndCallButton, MicrophoneButton, SpeakerButton, StartCallButton } from '@/components/ui/CallButtons';
import { Toast } from '@/components/ui/Toast';
import { useToast } from '@/components/ui/ToastProvider';
import { H1 } from '@/components/ui/Typography';
import { UserProfile } from '@/components/ui/UserProfile';
import { VoiceIndicator } from '@/components/VoiceIndicator';
import { useLiveAPIContext } from '@/contexts/LiveAPIContext';
import { usePricingModal } from '@/contexts/PricingModalContext';
import { useMediaStreamMux } from '@/hooks/use-media-stream-mux';
import { useSubscriptionStatus } from '@/hooks/useSubscriptionStatus';
import { PricingModalSource } from '@/types/pricing';
import { LiveConnectConfig, Modality, Tool } from '@google/genai';
import { AnimatePresence, motion } from 'framer-motion';
import { useSession } from 'next-auth/react';
import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FaUser } from 'react-icons/fa';
import { IoCloseOutline } from 'react-icons/io5';
import { useWakeLock } from 'react-screen-wake-lock';
import { MEERA_VOICE_CONFIG } from './config';

interface MeeraVoiceProps {
  className?: string;
  onClose?: (wasConnected: boolean) => void;
  isOpen?: boolean;
}

const THIRTY_SECONDS = 30;

export const MeeraVoice = ({ className, onClose, isOpen = true }: MeeraVoiceProps) => {
  const { data: sessionData, status: sessionAuthStatus } = useSession();
  const {
    data: subscriptionData,
    isLoading: isLoadingSubscription,
    error: subscriptionError,
  } = useSubscriptionStatus();

  const [showUserProfile, setShowUserProfile] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [callEndedDueToTalktime, setCallEndedDueToTalktime] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Enhanced refs for better state management
  const autoCallInitiatedRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const pricingModalShownRef = useRef(false);
  const isConnectingRef = useRef(false);
  const componentMountedRef = useRef(true);
  const autoStartTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const callDurationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const wakeLockActiveRef = useRef(false);

  const { showToast } = useToast();
  const { isSupported, request, release } = useWakeLock();
  const { client, connected, connect, disconnect, volume, isSpeaking } = useLiveAPIContext();
  const { start, stop, isMuted, toggleMute } = useMediaStreamMux();
  const { openModal } = usePricingModal();
  const currentTotalTalkTime = subscriptionData?.talktime_left ?? 0;

  useEffect(() => {
    if (error) {
      showToast(error, {
        type: 'error',
        position: 'meera-voice',
      });
      setError(null);
    }
  }, [error, showToast]);

  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      setError(e.message || 'An unknown connection error occurred.');
    };
    client.on('error', onError);
    return () => {
      client.off('error', onError);
    };
  }, [client]);

  // Determine if subscription is active
  const isPaid = !!subscriptionData?.plan_type && subscriptionData.plan_type !== 'free_trial';
  const hasActiveSub =
    !!subscriptionData?.subscription_end_date && new Date(subscriptionData.subscription_end_date) >= new Date();

  // Cleanup function to reset all states and refs
  const cleanup = useCallback(() => {
    if (callDurationIntervalRef.current) {
      clearInterval(callDurationIntervalRef.current);
      callDurationIntervalRef.current = null;
    }
    if (autoStartTimeoutRef.current) {
      clearTimeout(autoStartTimeoutRef.current);
      autoStartTimeoutRef.current = null;
    }
    if (wakeLockActiveRef.current) {
      release();
      wakeLockActiveRef.current = false;
    }
    setIsConnecting(false);
    setCallDuration(0);
    setCallEndedDueToTalktime(false);
    isConnectingRef.current = false;
    autoCallInitiatedRef.current = false;
    pricingModalShownRef.current = false;
  }, [release]);

  // Component mount/unmount tracking
  useEffect(() => {
    componentMountedRef.current = true;
    return () => {
      componentMountedRef.current = false;
      cleanup();
    };
  }, [cleanup]);

  // Update initialization state
  useEffect(() => {
    if (!componentMountedRef.current) return;

    if (sessionAuthStatus === 'loading' || isLoadingSubscription) {
      setIsInitializing(true);
    } else {
      setIsInitializing(false);
    }
  }, [sessionAuthStatus, isLoadingSubscription]);

  // Update onClose ref
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Enhanced call duration tracking
  useEffect(() => {
    if (!componentMountedRef.current) return;

    // Clear existing interval
    if (callDurationIntervalRef.current) {
      clearInterval(callDurationIntervalRef.current);
      callDurationIntervalRef.current = null;
    }

    if (connected) {
      callDurationIntervalRef.current = setInterval(() => {
        if (componentMountedRef.current) {
          setCallDuration((prev) => prev + 1);
        }
      }, 1000);
    } else {
      setCallDuration(0);
    }

    return () => {
      if (callDurationIntervalRef.current) {
        clearInterval(callDurationIntervalRef.current);
        callDurationIntervalRef.current = null;
      }
    };
  }, [connected]);

  // Hide "Connecting..." text when connected
  useEffect(() => {
    if (connected) {
      setIsConnecting(false);
      isConnectingRef.current = false;
    }
  }, [connected]);

  // Enhanced wake lock management
  useEffect(() => {
    if (!isSupported || !componentMountedRef.current) return;

    const manageWakeLock = async () => {
      if (connected && !wakeLockActiveRef.current) {
        try {
          await request();
          wakeLockActiveRef.current = true;
        } catch (err) {
          console.error('[WakeLock] Error:', err);
        }
      } else if (!connected && wakeLockActiveRef.current) {
        release();
        wakeLockActiveRef.current = false;
      }
    };

    manageWakeLock();

    return () => {
      if (wakeLockActiveRef.current) {
        release();
        wakeLockActiveRef.current = false;
      }
    };
  }, [
    connected,
    isSupported,
    request,
    release,
  ]);

  const endCall = useCallback(async () => {
    stop();
    await disconnect();
  }, [disconnect, stop]);

  // Ensure microphone is stopped when connection is lost
  useEffect(() => {
    if (!connected) {
      stop();
    }
  }, [connected, stop]);

  // Enhanced call state management with better error handling
  useEffect(() => {
    if (!componentMountedRef.current) return;

    if (!connected) {
      return;
    }

    const isFreeTrial = subscriptionData?.plan_type === 'free_trial';

    const checkTimeAndWarnOrEnd = () => {
      if (!componentMountedRef.current) return;

      let shouldWarn = false;
      let shouldEnd = false;

      if (currentTotalTalkTime > 0) {
        if (callDuration === currentTotalTalkTime - THIRTY_SECONDS) {
          shouldWarn = true;
        }
        if (callDuration >= currentTotalTalkTime) {
          shouldEnd = true;
        }
      } else {
        shouldEnd = true;
      }

      if (shouldWarn) {
        showToast('Your talktime will finish in 30 seconds', {
          type: 'info',
          position: 'meera-voice',
        });
      }
      if (shouldEnd && !pricingModalShownRef.current && componentMountedRef.current) {
        pricingModalShownRef.current = true;
        setCallEndedDueToTalktime(true);
        openModal('during_call_talktime_ended', false);
        endCall();
      }
    };

    if (isFreeTrial) {
      checkTimeAndWarnOrEnd();
    }
  }, [
    connected,
    callDuration,
    currentTotalTalkTime,
    endCall,
    showToast,
    callEndedDueToTalktime,
    openModal,
    subscriptionData,
  ]);

  // Enhanced start call function with better error handling
  const handleStartCall = useCallback(async () => {
    if (!componentMountedRef.current || isConnectingRef.current) {
      return;
    }

    if (!subscriptionData) {
      const subscriptionErrorMessage =
        typeof subscriptionError === 'object' &&
        subscriptionError !== null &&
        'message' in subscriptionError &&
        typeof subscriptionError.message === 'string'
          ? subscriptionError.message
          : null;
      console.warn('[MeeraVoice] Subscription verification unavailable. Continuing with fallback.', {
        subscriptionErrorMessage,
      });
    }

    if (!process.env.NEXT_PUBLIC_GEMINI_API_KEY) {
      showToast('Voice is not configured. Missing NEXT_PUBLIC_GEMINI_API_KEY.', {
        type: 'error',
        position: 'meera-voice',
      });
      return;
    }

    try {
      setIsConnecting(true);
      isConnectingRef.current = true;
      setCallEndedDueToTalktime(false);
      pricingModalShownRef.current = false;

      if (subscriptionData) {
        const isPaidUser = subscriptionData.plan_type !== 'free_trial';
        const isSubscriptionActive =
          !!subscriptionData.subscription_end_date && new Date(subscriptionData.subscription_end_date) >= new Date();
        const talkTimeAvailable = currentTotalTalkTime > 0;

        const isCallPossible = isPaidUser ? isSubscriptionActive : talkTimeAvailable && isSubscriptionActive;

        if (!isCallPossible) {
          if (isPaidUser && !isSubscriptionActive) {
            openModal('plan_expired_still_calling', true);
          } else if (!isPaidUser) {
            openModal('plan_expired_still_calling', false);
          }
          setIsConnecting(false);
          isConnectingRef.current = false;
          return;
        }
      }

      // Check if component is still mounted before proceeding
      if (!componentMountedRef.current) return;

      const { model_name, model_fallbacks, temperature, max_tokens, system_prompt, google_search } =
        MEERA_VOICE_CONFIG;

      const tools: Tool[] = [];
      if (google_search) {
        tools.push({ googleSearch: {} });
      }
      const config: LiveConnectConfig = {
        responseModalities: [Modality.AUDIO],
        temperature: temperature,
        maxOutputTokens: max_tokens,
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } },
        },
        systemInstruction: {
          parts: [
            {
              text: system_prompt,
            },
          ],
        },
        tools: tools,
        // realtimeInputConfig: {
        //   automaticActivityDetection: {
        //     startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
        //     prefixPaddingMs: 50,
        //     endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_HIGH,
        //     silenceDurationMs: 800,
        //   },
        // },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      };

      const modelsToTry = Array.from(new Set([
        model_name,
        ...(model_fallbacks || []),
      ]));

      let didConnect = false;
      for (const modelCandidate of modelsToTry) {
        didConnect = await connect(modelCandidate, config);
        if (didConnect) {
          break;
        }
      }

      if (!didConnect) {
        throw new Error('Unable to connect to voice model. Please try again in a moment.');
      }

      start({ audio: { mic: true, system: false }, video: false });
    } catch (err) {
      console.error('Caught error in handleStartCall:', err);

      if (componentMountedRef.current) {
        const errorMessage = (err as { message?: string })?.message || 'Failed to start call. Please try again.';
        showToast(errorMessage, {
          type: 'error',
          position: 'meera-voice',
        });
        setIsConnecting(false);
        isConnectingRef.current = false;
        await endCall(); // Ensure cleanup on error
      }
    }
  }, [
    connect,
    start,
    openModal,
    showToast,
    subscriptionData,
    subscriptionError,
    currentTotalTalkTime,
    endCall,
    sessionData,
  ]);

  // Enhanced auto-start logic with better race condition handling
  useEffect(() => {
    if (!componentMountedRef.current) return;

    // Clear any existing timeout
    if (autoStartTimeoutRef.current) {
      clearTimeout(autoStartTimeoutRef.current);
      autoStartTimeoutRef.current = null;
    }

    const shouldAttemptAutoStart =
      isOpen &&
      !autoCallInitiatedRef.current &&
      !isInitializing &&
      !isConnecting &&
      !isConnectingRef.current &&
      !isLoadingSubscription &&
      subscriptionData &&
      !connected;

    if (shouldAttemptAutoStart) {
      const isPaidUser = subscriptionData.plan_type !== 'free_trial';
      const talkTimeAvailable = currentTotalTalkTime > 0;
      const isSubscriptionActive =
        !!subscriptionData.subscription_end_date && new Date(subscriptionData.subscription_end_date) >= new Date();

      const isSubscriptionValidForAutoStart = isPaidUser
        ? isSubscriptionActive
        : talkTimeAvailable && isSubscriptionActive;

      // Add a small delay to prevent rapid auto-start cycles
      autoStartTimeoutRef.current = setTimeout(() => {
        if (!componentMountedRef.current || autoCallInitiatedRef.current) return;

        autoCallInitiatedRef.current = true;

        if (isSubscriptionValidForAutoStart) {
          handleStartCall();
        } else {
          if (isPaidUser && !isSubscriptionActive) {
            openModal('paid_sub_expired', true);
          } else {
            // Free trial
            let source: PricingModalSource | undefined;
            if (!isSubscriptionActive) {
              source = 'free_trial_expired';
            } else if (!talkTimeAvailable) {
              source = 'free_talktime_expired';
            }
            if (source) {
              openModal(source, false);
            }
          }
        }
      }, 300);
    }

    return () => {
      if (autoStartTimeoutRef.current) {
        clearTimeout(autoStartTimeoutRef.current);
        autoStartTimeoutRef.current = null;
      }
    };
  }, [
    isOpen,
    isInitializing,
    isConnecting,
    isLoadingSubscription,
    subscriptionData,
    connected,
    handleStartCall,
    currentTotalTalkTime,
    openModal,
  ]);

  // Enhanced component close handling
  useEffect(() => {
    if (!componentMountedRef.current) return;

    if (!isOpen) {
      // Reset states immediately when closing
      autoCallInitiatedRef.current = false;
      pricingModalShownRef.current = false;

      // Clear timeouts
      if (autoStartTimeoutRef.current) {
        clearTimeout(autoStartTimeoutRef.current);
        autoStartTimeoutRef.current = null;
      }

      // Disconnect if connected
      if (connected) {
        endCall();
      }

      // Cleanup after a short delay
      const cleanupTimeout = setTimeout(() => {
        if (componentMountedRef.current) {
          cleanup();
        }
      }, 100);

      return () => clearTimeout(cleanupTimeout);
    }
  }, [
    isOpen,
    connected,
    endCall,
    cleanup,
  ]);

  // Enhanced end call handler
  const handleEndCall = useCallback(async () => {
    if (!componentMountedRef.current) return;

    try {
      pricingModalShownRef.current = false;
      await endCall();
      onClose?.(true);
    } catch (error) {
      console.error('Failed to end call:', error);
    }
  }, [endCall, onClose]);

  // Enhanced close click handler
  const handleCloseClick = useCallback(async () => {
    if (!componentMountedRef.current) return;

    if (connected) {
      await endCall();
      onClose?.(true);
    } else {
      // Close immediately if not connected
      onClose?.(false);
    }
  }, [
    connected,
    endCall,
    onClose,
  ]);

  const renderButtonBarDiv = !isConnecting;
  let buttonBarClasses = 'bg-[#E0D8CD] rounded-full flex items-center';
  buttonBarClasses += ' py-2 px-3 md:px-4 space-x-1 md:space-x-2';

  return (
    <AnimatePresence>
      {(isOpen || connected) && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{
            type: 'tween',
            duration: 0.3,
            ease: 'easeInOut',
          }}
          className="fixed inset-0 z-50 bg-background"
        >
          <main className={`h-[100dvh] bg-background flex flex-col relative ${className}`}>
            <header className="pt-4 pb-2 px-4 md:px-12 w-full z-10 bg-background">
              <div className="w-full mx-auto flex items-center justify-between">
                <button
                  onClick={() => setShowUserProfile(true)}
                  className={`flex items-center justify-center w-9 h-9 rounded-full border-2 border-primary/20 hover:border-primary/50 transition-colors text-primary ${
                    sessionAuthStatus === 'authenticated' && sessionData?.user?.image ? '' : 'p-2'
                  }`}
                >
                  {sessionAuthStatus === 'authenticated' && sessionData?.user?.image ? (
                    <Image
                      src={sessionData.user.image}
                      alt="Profile"
                      width={32}
                      height={32}
                      className="w-full h-full object-cover rounded-full"
                    />
                  ) : (
                    <FaUser size={20} className="text-primary" />
                  )}
                </button>

                <div className="absolute left-1/2 transform -translate-x-1/2 flex items-center gap-1.5">
                  <H1 className="text-lg md:text-xl font-sans">{process.env.NEXT_PUBLIC_APP_NAME}</H1>
                  {connected && (
                    <div className="text-sm mt-1 font-medium text-primary">
                      {Math.floor(callDuration / 3600) > 0 &&
                        `${Math.floor(callDuration / 3600)
                          .toString()
                          .padStart(2, '0')}:`}
                      {Math.floor((callDuration % 3600) / 60)
                        .toString()
                        .padStart(2, '0')}
                      :{(callDuration % 60).toString().padStart(2, '0')}
                    </div>
                  )}
                </div>

                <button
                  onClick={handleCloseClick}
                  className="flex items-center justify-center w-9 p-2 h-9 rounded-full border-2 border-primary/20 hover:border-primary/50 transition-colors text-primary"
                  aria-label="Close"
                >
                  <IoCloseOutline size={24} className="text-primary" />
                </button>
              </div>
            </header>

            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full px-4">
              <div className="flex flex-col items-center">
                <VoiceIndicator
                  userImage="/icons/meera.svg"
                  size="normal"
                  volume={volume}
                  connected={connected}
                  isSpeaking={isSpeaking}
                />
                <div className="h-6 mt-20 relative">
                  <Toast
                    position="meera-voice"
                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-max max-w-sm"
                  />
                  {isConnecting && <div className="text-sm text-primary/70 text-center">Connecting...</div>}
                  {connected && !isSpeaking && !isConnecting && (
                    <div className="text-sm text-primary/70 text-center">Listening...</div>
                  )}
                </div>

                {!isLoadingSubscription && !isInitializing && !subscriptionError && isPaid && !hasActiveSub && (
                  <div className="mt-6 px-4 py-2 rounded-md border border-red-500 bg-[#E7E5DA] backdrop-blur-sm shadow-md">
                    <span className="text-sm">
                      Your subscription has expired.{' '}
                      <span
                        className="text-primary font-medium cursor-pointer underline"
                        onClick={() => openModal('subscription_has_ended_renew_here_toast_clicked', true)}
                      >
                        Renew here
                      </span>
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-auto z-10 flex flex-col items-center px-4">
              <div className="py-6 md:py-8 mb-4 md:mb-6 flex justify-center">
                {renderButtonBarDiv &&
                  (!connected && !isConnecting ? (
                    <StartCallButton
                      onClick={handleStartCall}
                      disabled={isConnecting || isLoadingSubscription || isConnectingRef.current}
                    />
                  ) : isConnecting ? null : (
                    <div className={buttonBarClasses}>
                      <MicrophoneButton onClick={toggleMute} isMuted={isMuted} />
                      <SpeakerButton />
                      <EndCallButton onClick={handleEndCall} />
                    </div>
                  ))}
              </div>
            </div>
          </main>
          {showUserProfile && <UserProfile isOpen={showUserProfile} onClose={() => setShowUserProfile(false)} />}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default MeeraVoice;
