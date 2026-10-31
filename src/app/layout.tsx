import "./globals.css";
import type { Metadata, Viewport } from "next";
import AppShell from "@/components/AppShell";
export const metadata: Metadata = { manifest: "/manifest.webmanifest", icons: { apple: "/icons/icon-192.png" }, title: { default: "CIPCO Operations", template: "%s · CIPCO Operations" }, description: "Employee onboarding and operations — Chandrika Industrial Projects Company" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1e4fa3", viewportFit: "cover" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body><AppShell>{children}</AppShell></body></html>);
}
