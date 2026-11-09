import type { Metadata, Viewport } from "next";
import { ThemeProvider } from "@/contexts/ThemeContext";
import "./globals.css";

// A fresh request is required for each CSP nonce.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Welcome to Meera — Your Personal Companion",
  description:
    "A gentle introduction to Meera. Share a little about yourself, at your own pace.",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { themeColor: "#0c3c26" };
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
