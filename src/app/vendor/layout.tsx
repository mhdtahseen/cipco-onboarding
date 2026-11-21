import type { Metadata } from "next";

// The vendor's page is opened from a link sent on WhatsApp, so the link preview and the tab say what it is. The link carries the vehicle's token, so the page
// never sends it on to another site (no Referer) and is never listed by search engines.
export const metadata: Metadata = {
  title: { absolute: "CIPCO · Your vehicle account" },
  description: "Your trips and payments with CIPCO.",
  referrer: "no-referrer",
  robots: { index: false, follow: false, nocache: true },
  openGraph: { type: "website", siteName: "CIPCO", title: "CIPCO · Your vehicle account", description: "Your trips and payments with CIPCO. Open it and enter your PIN.", images: [{ url: "/branding/logo.png", width: 464, height: 186 }] },
};

export default function VendorLayout({ children }: { children: React.ReactNode }) {
  return children;
}
