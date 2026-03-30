'use client';

import { H1 } from '@/components/ui/Typography';
import Link from 'next/link';

// import { Navbar } from '@/app/about/components/Navbar';
// import { Footer } from '@/app/about/components/Footer';

export default function Terms() {
  const appName = process.env.NEXT_PUBLIC_APP_NAME ;
  const appNameOS = `${appName} OS`;

  return (
    <main className="flex-auto bg-white">
      {/* <Navbar /> */}
      <div className="relative py-16 sm:py-24 px-4 sm:px-8 md:px-16 mx-auto max-w-4xl">
        <div className="mx-auto">
          <H1 className="text-3xl sm:text-4xl font-bold tracking-tight text-primary mb-10 font-sans">
            Terms and Conditions for {appNameOS}
          </H1>
          <div className="mt-10 space-y-7 text-base text-primary/80">
            <p>Effective Date: 1/1/2025</p>

            <p>
              Welcome to {appNameOS}. By accessing or using {appNameOS}, you agree to comply with and be bound by the
              following Terms and Conditions. Please read them carefully before using our platform.
            </p>

            <h2 className="text-2xl font-bold text-primary mt-12 mb-4">1. Acceptance of Terms</h2>
            <p>
              By creating an account, accessing, or using {appNameOS}, you agree to abide by these Terms and Conditions.
              If you do not agree, please discontinue the use of {appNameOS} immediately.
            </p>

            <h2 className="text-2xl font-bold text-primary mt-12 mb-4">2. Eligibility</h2>
            <ul className="list-disc space-y-2 pl-5">
              <li>You must be at least 13 years old to use {appNameOS}.</li>
              <li>
                By using {appNameOS}, you represent that you have the legal capacity to enter into this agreement.
              </li>
            </ul>

            <h2 className="text-2xl font-bold text-primary mt-12 mb-4">3. Account Responsibilities</h2>
            <ul className="list-disc space-y-2 pl-5">
              <li>You are responsible for maintaining the confidentiality of your account credentials.</li>
              <li>
                You agree to provide accurate and complete information during registration and to update your
                information as needed.
              </li>
              <li>You are responsible for all activities that occur under your account.</li>
            </ul>

            <h2 className="text-2xl font-bold text-primary mt-12 mb-4">4. Usage Guidelines</h2>
            <p>You agree to use {appNameOS} in compliance with all applicable laws and regulations. You must not:</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>Use {appNameOS} for unlawful purposes.</li>
              <li>Attempt to interfere with or disrupt the platform&apos;s functionality or security.</li>
              <li>Share or upload harmful content, including viruses or malicious software.</li>
            </ul>

            <h2 className="text-2xl font-bold text-primary mt-12 mb-4">5. Intellectual Property</h2>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                All content, features, and functionality provided by {appNameOS}, including text, graphics, logos, and
                software, are the exclusive property of {appNameOS} and its licensors.
              </li>
              <li>
                You may not copy, reproduce, or distribute any content from {appNameOS} without prior written consent.
              </li>
            </ul>

            <h2 className="text-2xl font-bold text-primary mt-12 mb-4">6. Payment and Subscription</h2>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                {appNameOS} offers a single subscription plan:
                <br />
                {/* Monthly Plan: ₹99 per month
                <br /> */}
                Lifetime Plan: ₹499
                <br/>
                Payments must be made in accordance with the pricing details provided at the time of purchase.
                Subscription payments are non-refundable unless required by applicable laws.
              </li>
              <li>
                For refund requests, please contact us at{' '}
                <a href="mailto:siddharth.nag@himeera.com" className="text-primary hover:text-primary/70">
                  siddharth.nag@himeera.com
                </a>{' '}
                with your subscription details and reason for the request. If you are approved, then your refund will be
                processed, and a credit will automatically be applied to your credit card or original method of payment,
                within 7 working days.
              </li>
            </ul>

            <h2 className="text-2xl font-bold text-primary mt-12 mb-4">7. Privacy</h2>
            <p>
              Your use of {appNameOS} is subject to our{' '}
              <Link href="/privacy" className="text-primary hover:text-primary/70 underline">
                Privacy Policy
              </Link>
              . By using the platform, you consent to the collection, storage, and use of your data as outlined in the
              Privacy Policy.
            </p>

            <h2 className="text-2xl font-bold text-primary mt-12 mb-4">8. Limitation of Liability</h2>
            <p>To the maximum extent permitted by law, {appNameOS} is not liable for:</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>Indirect, incidental, or consequential damages resulting from your use of the platform.</li>
              <li>Loss of data, revenue, or profits arising from your use of {appNameOS}.</li>
            </ul>

            <h2 className="text-2xl font-bold text-primary mt-12 mb-4">9. Service Availability</h2>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                {appNameOS} is provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis. We do not
                guarantee uninterrupted or error-free service.
              </li>
              <li>
                We reserve the right to modify, suspend, or discontinue the platform or any of its features at any time
                without prior notice.
              </li>
            </ul>

            <h2 className="text-2xl font-bold text-primary mt-12 mb-4">10. Termination</h2>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                We reserve the right to terminate or suspend your account if you violate these Terms and Conditions or
                engage in unauthorized activities.
              </li>
              <li>
                Upon termination, your access to {appNameOS} and any associated data may be restricted or deleted.
              </li>
            </ul>

            <h2 className="text-2xl font-bold text-primary mt-12 mb-4">11. Changes to Terms and Conditions</h2>
            <p>
              We may update these Terms and Conditions periodically. Continued use of {appNameOS} after changes are
              posted constitutes your acceptance of the updated terms.
            </p>

            <h2 className="text-2xl font-bold text-primary mt-12 mb-4">12. Governing Law</h2>
            <p>
              Based on our Udyam Registration Certificate, our business, Call {appName}OS, is registered under the
              jurisdiction of West Bengal, India.
              <br />
              <br />
              Official Address:
              <br />
              FLAT-F/10, 3RD FLOOR
              <br />
              P-167, PANDIT ISHAN CHANDRA ROAD RISHRA
              <br />
              HOOGHLY, WEST BENGAL - 712248
            </p>

            <h2 className="text-2xl font-bold text-primary mt-12 mb-4">13. Contact Us</h2>
            <p>If you have any questions or concerns about these Terms and Conditions, please contact us at:</p>
            <p className="mt-4">
              <strong>Email</strong>:{' '}
              <a href="mailto:siddharth.nag@himeera.com" className="text-primary hover:text-primary/70">
                siddharth.nag@himeera.com
              </a>
            </p>
          </div>
        </div>
      </div>
      {/* <Footer /> */}
    </main>
  );
}
