/** Production telemetry contract: deliberately excludes text/profile/audio payloads. */
export const EXPERIMENT_ID = 'onboarding_input_mode_v1';
export type InputMode = 'voice_first' | 'typed_first';
export const CLIENT_EVENTS = [
  'start',
  'mode_switch',
  'response_ready',
  'fallback',
  'correction',
  'optional_skip',
  'workspace_arrived',
  'useful_response_confirmed',
  'unpaid_checkout_arrived',
] as const;
export type ClientEvent = (typeof CLIENT_EVENTS)[number];
export const FALLBACK_REASONS = [
  'permission_denied',
  'unsupported_device',
  'provider_error',
  'quota',
  'autoplay_blocked',
  'timeout',
] as const;
export type ExperimentEvent = {
  event: ClientEvent;
  eventId: string;
  durationMs?: number;
  reason?: (typeof FALLBACK_REASONS)[number];
  mode?: InputMode;
};
export function validateEvent(value: unknown): ExperimentEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid event');
  const body = value as Record<string, unknown>;
  if (
    Object.keys(body).some(
      (key) =>
        !['event', 'eventId', 'durationMs', 'reason', 'mode'].includes(key),
    )
  )
    throw new Error('Unsupported event field');
  if (
    !CLIENT_EVENTS.includes(body.event as ClientEvent) ||
    typeof body.eventId !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      body.eventId,
    )
  )
    throw new Error('Invalid event');
  if (
    body.durationMs !== undefined &&
    (!Number.isSafeInteger(body.durationMs) ||
      Number(body.durationMs) < 0 ||
      Number(body.durationMs) > 300000)
  )
    throw new Error('Invalid duration');
  if (body.event === 'response_ready' && body.durationMs === undefined)
    throw new Error('Response timing is required');
  if (
    body.reason !== undefined &&
    !FALLBACK_REASONS.includes(body.reason as (typeof FALLBACK_REASONS)[number])
  )
    throw new Error('Invalid fallback reason');
  if (body.event === 'fallback' && body.reason === undefined)
    throw new Error('Fallback reason is required');
  if (
    body.mode !== undefined &&
    !['voice_first', 'typed_first'].includes(String(body.mode))
  )
    throw new Error('Invalid input mode');
  if (body.event === 'mode_switch' && body.mode === undefined)
    throw new Error('Mode is required');
  return body as ExperimentEvent;
}
export function requiredAcceptanceChecks(): string[] {
  const devices = ['desktop_chrome', 'android_chrome', 'iphone_safari'];
  return [
    ...devices.flatMap((device) =>
      ['sarah', 'brian'].flatMap((voice) =>
        ['en', 'hi', 'hinglish'].map(
          (language) =>
            `${device}:${voice}:${language}:speech_correction_skip_save_reload`,
        ),
      ),
    ),
    ...devices.flatMap((device) =>
      [
        'denied_mic_typing',
        'two_account_isolation',
        'microphone_release',
        'completed_onward',
        'unpaid_checkout',
      ].map((check) => `${device}:${check}`),
    ),
    'release_baseline_verified',
    'rollback_tested',
    'reporting_access_verified',
    'provider_budget_verified',
    'telemetry_privacy_verified',
    'measurement_integration_verified',
    'onward_entitlement_verified',
  ];
}
export const ACCEPTANCE_CHECKS = requiredAcceptanceChecks();
export type Assignment = {
  enabled: boolean;
  assigned: boolean;
  variant?: InputMode;
  version?: number;
  exposed?: boolean;
  signupAt?: string;
};
