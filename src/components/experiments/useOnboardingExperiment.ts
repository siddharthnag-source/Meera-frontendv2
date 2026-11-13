'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { onboardingAuth } from '@/lib/onboarding-auth-client';
import type {
  Assignment,
  ClientEvent,
  ExperimentEvent,
  InputMode,
} from '@/lib/experiments/onboarding-contract';
const OFF: Assignment = { enabled: false, assigned: false };
export function useOnboardingExperiment(userId?: string) {
  const [resolved, setResolved] = useState(false);
  const [assignment, setAssignment] = useState<Assignment>(OFF);
  const current = useRef<Assignment>(OFF);
  const generation = useRef(0);
  const identity = useRef(userId);
  identity.current = userId;
  const api = useCallback(async (route: string, payload?: object) => {
    const actor = identity.current;
    const auth = onboardingAuth();
    if (!actor || !auth) throw Error('Not signed in');
    const { data } = await auth.auth.getSession();
    if (data.session?.user.id !== actor) throw Error('Account changed');
    const response = await fetch(`/api/experiments/onboarding/${route}`, {
      method: payload ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: payload ? JSON.stringify(payload) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw Error('Experiment unavailable');
    const result = await response.json();
    if (actor !== identity.current) throw Error('Account changed');
    return result;
  }, []);
  useEffect(() => {
    const attempt = ++generation.current;
    let active = true;
    current.current = OFF;
    setAssignment(OFF);
    setResolved(false);
    if (
      !userId ||
      process.env.NEXT_PUBLIC_ONBOARDING_EXPERIMENT_UI !== 'true'
    ) {
      setResolved(true);
      return;
    }
    const qa =
      new URLSearchParams(window.location.search).get('experiment_qa') === '1';
    const refresh = async () => {
      try {
        const next = await api(
          'assignment',
          window.location.pathname === '/onboarding'
            ? { expose: false, qa }
            : undefined,
        );
        if (active && attempt === generation.current) {
          current.current = next;
          setAssignment(next);
          setResolved(true);
        }
      } catch {
        if (active && attempt === generation.current) {
          current.current = OFF;
          setAssignment(OFF);
          setResolved(true);
        }
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    return () => {
      active = false;
      clearInterval(timer);
      generation.current++;
      current.current = OFF;
    };
  }, [userId, api]);
  const expose = useCallback(async () => {
    const a = current.current;
    if (!a.assigned || !a.enabled || a.exposed) return false;
    try {
      const next = await api('assignment', {
        expose: true,
        version: a.version,
        qa:
          new URLSearchParams(window.location.search).get('experiment_qa') ===
          '1',
      });
      current.current = next;
      setAssignment(next);
      return next.enabled && next.exposed;
    } catch {
      return false;
    }
  }, [api]);
  const track = useCallback(
    async (
      event: ClientEvent,
      properties: Omit<ExperimentEvent, 'event' | 'eventId'> = {},
    ) => {
      const a = current.current;
      if (
        !a.assigned ||
        (!a.exposed &&
          ![
            'workspace_arrived',
            'useful_response_confirmed',
            'unpaid_checkout_arrived',
          ].includes(event))
      )
        return false;
      try {
        return (
          (
            await api('event', {
              event,
              eventId: crypto.randomUUID(),
              ...properties,
            })
          ).accepted === true
        );
      } catch {
        return false;
      }
    },
    [api],
  );
  const mode: InputMode | null =
    assignment.enabled && assignment.assigned
      ? (assignment.variant ?? null)
      : null;
  return { mode, assignment, resolved, expose, track };
}
