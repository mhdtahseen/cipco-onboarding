import "./globals.css";
import "./dark.css";
import type { Metadata, Viewport } from "next";
import AppShell from "@/components/AppShell";
import { THEME_BOOT } from "@/lib/theme";
export const metadata: Metadata = { manifest: "/manifest.webmanifest", icons: { apple: "/icons/icon-192.png" }, title: { default: "CIPCO Operations", template: "%s · CIPCO Operations" }, description: "Employee onboarding and operations — Chandrika Industrial Projects Company" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: [{ media: "(prefers-color-scheme: light)", color: "#1e4fa3" }, { media: "(prefers-color-scheme: dark)", color: "#0e1420" }], viewportFit: "cover" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} /></head><body><AppShell>{children}</AppShell></body></html>);
}
