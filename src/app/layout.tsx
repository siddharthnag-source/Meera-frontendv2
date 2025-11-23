import type { Metadata, Viewport } from 'next';
import './globals.css';
import MetaPixel from '@/components/MetaPixel';
import { QueryClientProvider } from '@/components/providers/QueryProvider';
import { SessionProvider } from '@/components/providers/SessionProvider';
import { ToastProvider } from '@/components/ui/ToastProvider';
import { LiveAPIProvider } from '@/contexts/LiveAPIContext';
import { PWAInstallProvider } from '@/contexts/PWAInstallContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { LiveClientOptions } from '@/types/api';

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
    title: `${appName}`,
    description: "World's first Conscious Intelligence (CI)",
    openGraph: {
      title: `${appName}`,
      description: "World's first Conscious Intelligence (CI)",
      url: canonicalUrl,
      siteName: `${appName}`,
      type: 'website',
      images: [
        {
          url: new URL('/banner.png', canonicalUrl).toString(),
          alt: `${appName} - World's first Conscious Intelligence (CI)`,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${appName}`,
      description: "World's first Conscious Intelligence (CI)",
      images: [
        {
          url: new URL('/banner.png', canonicalUrl).toString(),
          alt: `${appName}  - World's first Conscious Intelligence (CI)`,
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

const apiOptions: LiveClientOptions = {
  apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY as string,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <MetaPixel />
      </head>
      <body className={`antialiased`} suppressHydrationWarning>
        <ThemeProvider>
          <PWAInstallProvider>
            <ToastProvider>
              <QueryClientProvider>
                <SessionProvider>
                  <LiveAPIProvider options={apiOptions}>{children}</LiveAPIProvider>
                </SessionProvider>
              </QueryClientProvider>
            </ToastProvider>
          </PWAInstallProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
