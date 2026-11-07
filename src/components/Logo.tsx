// The CIPCO mark: one small image (about a tenth of the size of the original), blue on light screens and turned white on dark ones by a filter (see .logo-img in globals.css),
// so there is only ever one download and no tile behind it.
export default function Logo({ className = "h-7 w-auto" }: { className?: string }) {
  return <img src="/branding/logo-sm.png" alt="CIPCO" width={360} height={144} className={`logo-img ${className}`} />;
}
