import "./globals.css";
import type { Metadata, Viewport } from "next";
import Nav from "@/components/Nav";
export const metadata: Metadata = { title: { default: "CIPCO Operations", template: "%s · CIPCO Operations" }, description: "Employee onboarding and operations — Chandrika Industrial Projects Company" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1e4fa3" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body><Nav /><main className="max-w-6xl mx-auto px-4 py-4 sm:py-6">{children}</main></body></html>);
}
