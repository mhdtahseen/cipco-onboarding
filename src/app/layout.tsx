import "./globals.css";
import "./dark.css";
import type { Metadata, Viewport } from "next";
import AppShell from "@/components/AppShell";
import { THEME_BOOT } from "@/lib/theme";
export const metadata: Metadata = {
  manifest: "/manifest.webmanifest",
  icons: { apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }] },
  title: { default: "CIPCO Operations", template: "%s · CIPCO Operations" },
  description: "Employee onboarding and operations — Chandrika Industrial Projects Company",
  applicationName: "CIPCO Operations",
  appleWebApp: { capable: true, title: "CIPCO", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
  openGraph: { type: "website", siteName: "CIPCO Operations", title: "CIPCO Operations", description: "Sign in to CIPCO Operations.", images: [{ url: "/branding/logo.png", width: 464, height: 186 }] },
  robots: { index: false, follow: false, nocache: true },   // a private business app: never listed by search engines
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: [{ media: "(prefers-color-scheme: light)", color: "#1e4fa3" }, { media: "(prefers-color-scheme: dark)", color: "#0e1420" }], viewportFit: "cover" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} /></head><body><AppShell>{children}</AppShell></body></html>);
}
