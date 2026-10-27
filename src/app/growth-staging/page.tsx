'use client';

import { supabase } from '@/lib/supabaseClient';
import { useEffect, useState } from 'react';
import Link from 'next/link';

type Report = { config: { enabled: boolean; allocation: number }; totals: { profiles: number; paid: number; refunded: number };
  assignment: { control: number; treatment: number; controlExposed: number; treatmentExposed: number }; generated_at: string };
type Assignment = { enabled: boolean; enrolled: boolean; variant: string };

async function api(operation?: string, values: Record<string, unknown> = {}) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error('Sign in to staging before using the workbench.');
  const response = await fetch('/api/growth-staging/workbench', { method: operation ? 'POST' : 'GET', cache: 'no-store',
    headers: { Authorization: `Bearer ${data.session.access_token}`, ...(operation ? { 'Content-Type': 'application/json' } : {}) },
    ...(operation ? { body: JSON.stringify({ operation, ...values }) } : {}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Workbench request failed');
  return result;
}

export default function GrowthStagingPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = async () => setReport(await api());
  useEffect(() => { let cancelled = false; api().then(r => { if (!cancelled) setReport(r); })
    .catch(e => { if (!cancelled) setError(e.message); }); return () => { cancelled = true; }; }, []);
  // Exposure is recorded only after the assigned preview has committed to the DOM.
  useEffect(() => { if (assignment?.enabled && assignment.enrolled) {
    api('expose').then(() => refresh()).catch(e => setError(e.message));
  } }, [assignment]);
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(''); try { await action(); } catch (e) {
    setError(e instanceof Error ? e.message : 'Operation failed'); } finally { setBusy(false); } };
  return <main className="mx-auto max-w-3xl space-y-6 p-6 text-primary">
    <h1 className="text-3xl font-semibold">Growth staging workbench</h1>
    <p>Synthetic data only. Use this workspace to verify checkout reporting and experiment mechanics. All records here are excluded from production acquisition and revenue. AI services and Meta delivery are outside this check.</p>
    <nav className="flex gap-5"><Link className="underline" href="/sign-in?offer=us-lifetime">Staging sign in</Link><Link className="underline" href="/payment?offer=us-lifetime">US checkout</Link></nav>
    {error && <p role="alert" className="rounded border border-red-700 p-3">{error}</p>}
    <button disabled={busy} className="rounded border px-4 py-2" onClick={() => run(refresh)}>Refresh report</button>
    {report && <>
      <section className="space-y-2 rounded border p-4"><h2 className="text-xl font-semibold">Aggregate test payment report</h2>
        <p>Profiles {report.totals.profiles} · Active paid entitlements {report.totals.paid} · Refunded payments {report.totals.refunded}</p>
        <p>Assigned control {report.assignment.control} · Assigned treatment {report.assignment.treatment}</p>
        <p>Exposed control {report.assignment.controlExposed} · Exposed treatment {report.assignment.treatmentExposed}</p>
        <p className="text-sm">Updated {report.generated_at} UTC</p></section>
      <section className="space-y-3 rounded border p-4"><h2 className="text-xl font-semibold">Experiment controls</h2>
        <p>Status {report.config.enabled ? 'Enabled' : 'Disabled'} · Enrollment {report.config.allocation}% · Split 50% control and 50% treatment</p>
        <p>Existing enrolled users keep their assignment. Disabling immediately stops new assignment and exposure requests; refresh the preview to remove an already rendered variant.</p>
        <div className="flex flex-wrap gap-3"><button disabled={busy} className="rounded border px-4 py-2" onClick={() => run(async () => {
          await api('configure', { enabled: !report.config.enabled, allocation: 100 }); setAssignment(null); await refresh();
        })}>{report.config.enabled ? 'Disable experiment' : 'Enable staging experiment'}</button>
        <button disabled={busy} className="rounded border px-4 py-2" onClick={() => run(async () => { setAssignment(await api('assign')); })}>Load assigned preview</button></div>
      </section>
    </>}
    {assignment && <section aria-label="Assigned experiment preview" className="rounded border p-4">
      <h2 className="text-xl font-semibold">{assignment.enabled && assignment.enrolled ? `${assignment.variant} preview` : 'Control preview'}</h2>
      <p>{assignment.enabled && assignment.enrolled ? 'This rendered preview records one first exposure for your account.' : 'Experiment disabled or account outside allocation. No exposure recorded.'}</p>
    </section>}
  </main>;
}
