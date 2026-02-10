"use client";

import { usePathname } from "next/navigation";

import { QueryClientProvider } from "@/components/providers/QueryProvider";
import { SessionProvider } from "@/components/providers/SessionProvider";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { LiveAPIProvider } from "@/contexts/LiveAPIContext";
import { PWAInstallProvider } from "@/contexts/PWAInstallContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { LiveClientOptions } from "@/types/api";

type ProvidersProps = {
  children: React.ReactNode;
};

const apiOptions: LiveClientOptions = {
  apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY as string,
};

export default function Providers({ children }: ProvidersProps) {
  const pathname = usePathname();
  const isSupabaseSmoke = pathname?.startsWith("/supabase-smoke");

  const content = isSupabaseSmoke ? (
    children
  ) : (
    <LiveAPIProvider options={apiOptions}>{children}</LiveAPIProvider>
  );

  return (
    <ThemeProvider>
      <PWAInstallProvider>
        <ToastProvider>
          <QueryClientProvider>
            <SessionProvider>{content}</SessionProvider>
          </QueryClientProvider>
        </ToastProvider>
      </PWAInstallProvider>
    </ThemeProvider>
  );
}
