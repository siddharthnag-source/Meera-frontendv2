import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  alternates: { canonical: '/sign-in' },
};

// Keep the app/chat viewport behavior unchanged; the public ad landing page
// supports browser zoom for visitors who need larger text.
export const viewport: Viewport = { maximumScale: 5, userScalable: true };

export default function SignInLayout({ children }: { children: ReactNode }) {
  return children;
}
