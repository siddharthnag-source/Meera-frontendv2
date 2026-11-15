export type ArmSummary = {
  variant: 'typed_first' | 'voice_first';
  assigned: number;
  started?: number;
  start_to_save_median_ms?: number | null;
  signup_to_save_median_ms?: number | null;
  exposed: number;
  matured: number;
  matured_useful: number;
  matured_saved: number;
  saved: number;
  responses: number;
  fallbacks: number;
};
export function wilson(
  successes: number,
  total: number,
): [number, number] | null {
  if (!total) return null;
  const z = 1.96,
    p = successes / total,
    d = 1 + (z * z) / total,
    c = (p + (z * z) / (2 * total)) / d,
    m =
      (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) /
      d;
  return [Math.max(0, c - m), Math.min(1, c + m)];
}
export function recommendation(arms: ArmSummary[], guardrailFailed = false) {
  if (guardrailFailed)
    return {
      decision: 'rollback',
      reason: 'A guardrail failed; disable allocation.',
    };
  const voice = arms.find((a) => a.variant === 'voice_first'),
    typed = arms.find((a) => a.variant === 'typed_first');
  if (!voice || !typed || voice.matured < 15 || typed.matured < 15)
    return {
      decision: 'hold',
      reason:
        'Insufficient matured users: need at least 15 per arm; no causal conclusion.',
    };
  const delta =
    voice.matured_useful / voice.matured - typed.matured_useful / typed.matured;
  const completionDelta =
    voice.matured_saved / voice.matured - typed.matured_saved / typed.matured;
  return {
    decision:
      delta < 0 || completionDelta < -0.05 - Number.EPSILON
        ? 'iterate_or_rollback'
        : delta >= 0.1 - Number.EPSILON
          ? 'keep_limited_pilot'
          : 'iterate',
    primaryDifference: delta,
    completionDifference: completionDelta,
    reason:
      'Directional small-sample learning only; this does not justify a global launch.',
  };
}
export function aggregateCsv(
  arms: ArmSummary[],
  latency: { variant: string; p50_ms: number; p95_ms: number }[] = [],
): string {
  const header = [
    'variant',
    'assigned',
    'exposed',
    'started',
    'matured',
    'matured_useful',
    'matured_saved',
    'saved',
    'responses',
    'fallbacks',
    'start_to_save_median_ms',
    'signup_to_save_median_ms',
    'response_p50_ms',
    'response_p95_ms',
  ];
  return (
    [
      header.join(','),
      ...arms.map((arm) => {
        const timing = latency.find((row) => row.variant === arm.variant);
        const a = {
          ...arm,
          response_p50_ms: timing?.p50_ms,
          response_p95_ms: timing?.p95_ms,
        };
        return header
          .map((k) => String(a[k as keyof typeof a] ?? ''))
          .join(',');
      }),
    ].join('\n') + '\n'
  );
}

export function guardrailFailures(report: {
  event_counts?: { event_name: string; reason: string | null; total: number }[];
  response_latency?: { measured: number; p95_ms: number }[];
  budgetVerified?: boolean;
  config?: { enabled: boolean };
}): string[] {
  const events = report.event_counts || [];
  const count = (reason: string) =>
    events
      .filter((e) => e.event_name === 'fallback' && e.reason === reason)
      .reduce((n, e) => n + e.total, 0);
  const failures: string[] = [];
  if (count('quota') >= 2)
    failures.push('At least two reported provider quota failures');
  const failed = count('provider_error') + count('timeout');
  const ready = events
    .filter((e) => e.event_name === 'response_ready')
    .reduce((n, e) => n + e.total, 0);
  if (ready + failed >= 20 && failed / (ready + failed) > 0.05)
    failures.push('Reported provider failure rate exceeds 5%');
  if (
    (report.response_latency || []).some(
      (row) => row.measured >= 10 && row.p95_ms > 8000,
    )
  )
    failures.push('p95 response delay exceeds 8 seconds');
  if (report.config?.enabled && report.budgetVerified === false)
    failures.push('Provider budget status is unknown or outside guardrails');
  return failures;
}
