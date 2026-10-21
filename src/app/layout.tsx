import "./globals.css";
import type { Metadata } from "next";
import Nav from "@/components/Nav";
export const metadata: Metadata = { title: "CIPCO Onboarding", description: "Employee onboarding documents" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body><Nav /><main className="max-w-6xl mx-auto px-4 py-6">{children}</main></body></html>);
}
