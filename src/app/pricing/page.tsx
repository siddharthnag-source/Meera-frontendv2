import { INTERNATIONAL_LIFETIME_PRICE_USD, PLAN_PRICES } from '@/components/PricingModal/constants';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Meera plans and pricing',
  description: 'See Meera plan prices, included features, and support information before signing in.',
};

const plans = [
  {
    name: 'Lifetime',
    price: PLAN_PRICES.lifetime,
    detail: 'One-time purchase for lifetime access in India. Secure payment with Cashfree.',
  },
] as const;

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-background px-5 py-16 text-primary sm:px-9">
      <div className="mx-auto max-w-4xl">
        <Link href="/sign-in" className="text-sm font-semibold underline underline-offset-4">
          ← Back to Meera
        </Link>
        <h1 className="mt-12 font-serif text-5xl tracking-tight sm:text-6xl">One payment. Meera for life.</h1>
        <p className="mt-5 max-w-2xl text-lg text-primary/70">
          Meera is a personal AI companion for conversation, web information, and images. Get lifetime access with one
          payment and no recurring subscription.
        </p>
        <div className="mt-10 grid gap-5 ">
          {plans.map((plan) => (
            <section key={plan.name} className="rounded-3xl border border-primary/15 bg-white p-7 shadow-sm">
              <h2 className="text-2xl font-semibold">{plan.name}</h2>
              <p className="mt-5 font-serif text-5xl">₹{plan.price}</p>
              <p className="mt-3 text-primary/70">{plan.detail}</p>
              <p className="mt-5 font-serif text-3xl">US${INTERNATIONAL_LIFETIME_PRICE_USD} internationally</p>
              <p className="mt-2 text-primary/70">The same lifetime access, paid once through Stripe. Local-currency equivalents may be offered at checkout.</p>
              <Link href="/sign-in?offer=us-lifetime" className="mt-5 inline-flex rounded-full bg-primary px-6 py-3 font-semibold text-background">
                Get US$99 lifetime access
              </Link>
              <p className="mt-6 text-sm text-primary/70">Includes text chat, web, and images.</p>
            </section>
          ))}
        </div>
        <p className="mt-7 text-sm leading-6 text-primary/70">
          Digital access is available in your account after payment is confirmed. The final amount, including any
          discount, is shown before you pay. Meera is sold by Meera Labs Inc.
        </p>
        <Link
          href="/sign-in"
          className="mt-8 inline-flex rounded-full bg-primary px-7 py-3 font-semibold text-background"
        >
          Continue to Meera
        </Link>
        <footer className="mt-16 flex flex-wrap gap-x-6 gap-y-3 border-t border-primary/15 pt-6 text-sm text-primary/70">
          <Link href="/terms" className="underline underline-offset-4">
            Terms
          </Link>
          <Link href="/privacy" className="underline underline-offset-4">
            Privacy
          </Link>
          <Link href="/refund-policy" className="underline underline-offset-4">
            Refunds and cancellations
          </Link>
          <a href="mailto:siddharth.nag@himeera.com" className="underline underline-offset-4">
            Support
          </a>
        </footer>
        <p className="mt-4 text-xs text-primary/60">
          Meera Labs Inc. · Registered legal address: 8 The Green, Ste R, Dover, DE 19901, United States.
        </p>
      </div>
    </main>
  );
}
