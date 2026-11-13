'use client';
import { useEffect, useState } from 'react';
import { onboardingAuth } from '@/lib/onboarding-auth-client';
import {
  aggregateCsv,
  guardrailFailures,
  recommendation,
  type ArmSummary,
} from '@/lib/experiments/onboarding-analysis';
type Report = {
  config: {
    enabled: boolean;
    version: number;
    starts_at: string | null;
    stops_at: string | null;
  };
  releaseReady: boolean;
  budgetVerified: boolean;
  generatedAt: string;
  arms: ArmSummary[];
  acceptance: {
    check_key: string;
    passed: boolean;
    evidence_ref: string | null;
  }[];
  qa_assignments: number;
  response_latency: {
    variant: string;
    measured: number;
    p50_ms: number;
    p95_ms: number;
  }[];
  event_counts: {
    variant: string;
    event_name: string;
    reason: string | null;
    total: number;
  }[];
};
export default function OnboardingExperimentControl() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState('');
  const [evidence, setEvidence] = useState('');
  async function api(body?: object) {
    const auth = onboardingAuth();
    const { data } = (await auth?.auth.getSession()) || {
      data: { session: null },
    };
    if (!data.session)
      throw Error(
        'Sign in with your named Google experiment operator account first.',
      );
    const response = await fetch('/api/experiments/onboarding/admin', {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    const result = await response.json();
    if (!response.ok)
      throw Error(result.error || 'Reporting access is unavailable.');
    return result;
  }
  async function load() {
    setBusy(true);
    setError('');
    try {
      setReport(await api());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function control(action: 'enable' | 'disable') {
    if (!report) return;
    setBusy(true);
    setError('');
    try {
      await api({ action, version: report.config.version });
      setReport(await api());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function download() {
    if (!report) return;
    const blob = new Blob(
      [aggregateCsv(report.arms, report.response_latency)],
      { type: 'text/csv' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'week-7-onboarding-aggregate.csv';
    a.click();
    URL.revokeObjectURL(url);
  }
  const guardrails = report ? guardrailFailures(report) : [];
  const decision = recommendation(report?.arms || [], guardrails.length > 0);
  return (
    <main style={{ maxWidth: 960, margin: '40px auto', padding: 24 }}>
      <h1>Onboarding input-mode pilot</h1>
      <p>
        Production switch, acceptance evidence and aggregate measurement. QA is
        excluded from pilot outcomes.
      </p>
      <button onClick={() => void load()} disabled={busy}>
        Refresh report
      </button>
      {error && <p role="alert">{error}</p>}
      {report && (
        <>
          <p role="status">
            Allocation: {report.config.enabled ? 'ON' : 'OFF'} · Release ready:{' '}
            {report.releaseReady ? 'yes' : 'no'} · Version{' '}
            {report.config.version}
          </p>
          <p>
            Named operator access verified by the reporting endpoint. Last read:{' '}
            {new Date(report.generatedAt).toLocaleString('en-IN', {
              timeZone: 'Asia/Kolkata',
            })}{' '}
            IST
          </p>
          <p>
            {decision.decision}: {decision.reason}
          </p>
          <button
            disabled={
              busy ||
              report.config.enabled ||
              !report.releaseReady ||
              report.acceptance.some((g) => !g.passed)
            }
            onClick={() => void control('enable')}
          >
            Activate 10% pilot (maximum 40 accounts)
          </button>{' '}
          <button disabled={busy} onClick={() => void control('disable')}>
            Disable allocation now
          </button>
          <p>
            Disabling stops new exposure. Existing participants can still record
            their 24-hour outcomes. Enable also verifies the provider budget
            server-side.
          </p>
          <h2>Aggregates</h2>
          <table>
            <thead>
              <tr>
                <th>Assigned mode</th>
                <th>Assigned</th>
                <th>Exposed</th>
                <th>Matured</th>
                <th>Matured useful</th>
                <th>Saved</th>
                <th>Fallbacks</th>
              </tr>
            </thead>
            <tbody>
              {report.arms.map((a) => (
                <tr key={a.variant}>
                  <td>{a.variant}</td>
                  <td>{a.assigned}</td>
                  <td>{a.exposed}</td>
                  <td>{a.matured}</td>
                  <td>{a.matured_useful}</td>
                  <td>{a.saved}</td>
                  <td>{a.fallbacks}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={download}>Export aggregate CSV for Week 7</button>
          <p>
            Internal QA assignments: {report.qa_assignments}. No identities,
            profile values, transcripts or recordings are included in this
            export.
          </p>
          <h2>Required acceptance</h2>
          <p>
            Only record evidence from actual devices and verified checks.
            Synthetic audio and emulation do not satisfy real-device gates.
          </p>
          <ul>
            {report.acceptance.map((g) => (
              <li key={g.check_key}>
                {g.passed ? '✓' : 'Pending'} {g.check_key}
                {g.evidence_ref && <> — {g.evidence_ref}</>}
              </li>
            ))}
          </ul>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              try {
                await api({
                  action: 'evidence',
                  check,
                  passed: true,
                  evidence,
                });
                setReport(await api());
                setEvidence('');
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Verified check{' '}
              <select
                required
                value={check}
                onChange={(e) => setCheck(e.target.value)}
              >
                <option value="">Select a check</option>
                {report.acceptance.map((g) => (
                  <option key={g.check_key}>{g.check_key}</option>
                ))}
              </select>
            </label>
            <label>
              Evidence reference (no profile data){' '}
              <input
                required
                maxLength={500}
                value={evidence}
                onChange={(e) => setEvidence(e.target.value)}
                placeholder="https://… or repo:…"
              />
            </label>
            <button disabled={busy}>Record verified pass</button>
          </form>
          <a href="/onboarding?experiment_qa=1">Open internal QA preview</a>
        </>
      )}
    </main>
  );
}
