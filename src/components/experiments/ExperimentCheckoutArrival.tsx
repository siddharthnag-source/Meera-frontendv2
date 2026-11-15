'use client';
import { useEffect, useRef } from 'react';
import { useOnboardingExperiment } from './useOnboardingExperiment';
/** `unpaid` must come from the existing server entitlement result, never profile completion. */
export function ExperimentCheckoutArrival({
  userId,
  unpaid,
}: {
  userId?: string;
  unpaid: boolean;
}) {
  const { assignment, resolved, track } = useOnboardingExperiment(userId);
  const recorded = useRef<string | null>(null);
  useEffect(() => {
    if (
      !userId ||
      !unpaid ||
      !resolved ||
      !assignment.assigned ||
      recorded.current === userId
    )
      return;
    recorded.current = userId;
    void track('unpaid_checkout_arrived').then((ok) => {
      if (!ok) recorded.current = null;
    });
  }, [
    userId,
    unpaid,
    resolved,
    assignment.exposed,
    assignment.assigned,
    track,
  ]);
  return null;
}
