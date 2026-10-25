import type { Metadata, Viewport } from 'next';
import './globals.css';
import MetaPixel from '@/components/MetaPixel';
import Providers from '@/components/Providers';
import { Suspense } from 'react';

// Function to generate metadata dynamically
export async function generateMetadata(): Promise<Metadata> {
  const siteUrl = process.env.NEXTAUTH_URL;
  if (!siteUrl) {
    throw new Error('NEXTAUTH_URL environment variable is not defined');
  }
  const canonicalUrl = siteUrl;
  const appName = process.env.NEXT_PUBLIC_APP_NAME;

  return {
    metadataBase: new URL(siteUrl),
    verification: {
      google: 'Ifiisb07Phvts9AKAl78XPD5H-yhGxLDh00nlw5Xky0',
    },
    title: `${appName} — Your Personal Companion`,
    description: 'Talk through bad days, learn something new, or simply have someone to talk to.',
    openGraph: {
      title: `${appName} — Your Personal Companion`,
      description: 'Talk through bad days, learn something new, or simply have someone to talk to.',
      url: canonicalUrl,
      siteName: `${appName}`,
      type: 'website',
      images: [
        {
          url: new URL('/banner.png', canonicalUrl).toString(),
          alt: `${appName} — Your Personal Companion`,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${appName} — Your Personal Companion`,
      description: 'Talk through bad days, learn something new, or simply have someone to talk to.',
      images: [
        {
          url: new URL('/banner.png', canonicalUrl).toString(),
          alt: `${appName} — Your Personal Companion`,
        },
      ],
    },
    alternates: {
      canonical: canonicalUrl,
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: 'default',
      title: `${appName}`,
    },
    formatDetection: {
      telephone: false,
    },
  };
}

export const viewport: Viewport = {
  themeColor: '#0c3c26',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <Suspense fallback={null}><MetaPixel /></Suspense>
      </head>
      <body className={`antialiased`} suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
