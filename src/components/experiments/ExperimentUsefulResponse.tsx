'use client';
import { useEffect, useRef, useState } from 'react';
import { useOnboardingExperiment } from './useOnboardingExperiment';
/** Mount only in Meera workspace after a real, completed non-onboarding answer.
 * responseId is an opaque message ID, never the content. Do not mount in onboarding.
 */
export function ExperimentUsefulResponse({
  userId,
  responseId,
  responseComplete,
}: {
  userId?: string;
  responseId?: string;
  responseComplete: boolean;
}) {
  const { assignment, resolved, track } = useOnboardingExperiment(userId);
  const [confirmed, setConfirmed] = useState(false);
  const entered = useRef<string | null>(null);
  useEffect(() => {
    setConfirmed(false);
    entered.current = null;
  }, [userId]);
  useEffect(() => {
    if (
      !resolved ||
      !assignment.assigned ||
      !userId ||
      entered.current === userId
    )
      return;
    entered.current = userId;
    void track('workspace_arrived');
  }, [resolved, assignment.assigned, assignment.exposed, userId, track]);
  if (!resolved || !assignment.assigned || !responseComplete || !responseId)
    return null;
  return (
    <div aria-label="First response usefulness">
      {confirmed ? (
        <p role="status">Thanks for letting us know.</p>
      ) : (
        <button
          type="button"
          onClick={async () => {
            if (
              (await track('workspace_arrived')) &&
              (await track('useful_response_confirmed'))
            )
              setConfirmed(true);
          }}
        >
          This helped
        </button>
      )}
    </div>
  );
}
