// The CIPCO mark. Blue on light screens, white on dark ones (the switch is in globals.css / dark.css), so it never needs a tile behind it.
export default function Logo({ className = "h-7 w-auto" }: { className?: string }) {
  return (<>
    <img src="/branding/logo-hd.png" alt="CIPCO" className={`logo-light ${className}`} />
    <img src="/branding/logo-white.svg" alt="CIPCO" className={`logo-dark ${className}`} />
  </>);
}
