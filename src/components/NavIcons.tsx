import type { IconName } from "@/lib/nav";

export type AnyIcon = IconName | "menu" | "x" | "chevron-left" | "chevron-right" | "chevron-down" | "logout" | "grid" | "phone" | "chat" | "download" | "more" | "eye" | "eye-off" | "copy" | "arrow-up" | "arrow-down";
const P: Record<AnyIcon, React.ReactNode> = {
  users: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
  "user-check": <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="m16 11 2 2 4-4" /></>,
  "crane": <><path d="M7 21V3" /><path d="M4 21h6" /><path d="M2.5 7.5h19" /><path d="m7 3 11 4.500" /><path d="M7 3 3.500 7.500" /><path d="M17.500 7.500v5" /><rect x="15.500" y="12.500" width="4" height="3.500" rx=".5" /></>,
  "calculator": <><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M8 6h8M16 14v4M16 10h.01M12 10h.01M8 10h.01M12 14h.01M8 14h.01M12 18h.01M8 18h.01" /></>,
  book: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>,
  mail: <><path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" /><path d="m22 6-10 7L2 6" /></>,
  "quote": <><path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z" /><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z" /></>,
  "gear": <><path d="M12.220 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.730l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.730.73l-.22.38a2 2 0 0 0 .73 2.730l.15.1a2 2 0 0 1 1 1.720v.51a2 2 0 0 1-1 1.740l-.15.09a2 2 0 0 0-.73 2.730l.22.38a2 2 0 0 0 2.730.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.730V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.730l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.730-.73l.22-.39a2 2 0 0 0-.73-2.730l-.15-.08a2 2 0 0 1-1-1.740v-.5a2 2 0 0 1 1-1.740l.15-.09a2 2 0 0 0 .73-2.730l-.22-.38a2 2 0 0 0-2.730-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.730V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></>,
  "user-cog": <><circle cx="9" cy="7" r="4" /><path d="M10 15H6a4 4 0 0 0-4 4v2" /><circle cx="18" cy="15" r="3" /><path d="m21.700 16.400-.9-.3M15.200 13.900l-.9-.3M16.600 18.700l.3-.9M19.100 12.200l.3-.9M19.600 18.700l-.4-1M16.800 12.300l-.4-1M14.300 16.600l1-.4M20.700 13.800l1-.4" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="M10.8 12.2L20 3M16 7l3 3M14 9l2 2" /></>,
  building: <><path d="M3 21h18" /><path d="M5 21V7l8-4v18" /><path d="M19 21V11l-6-4" /><path d="M9 9v.01M9 12v.01M9 15v.01M9 18v.01" /></>,
  wallet: <><path d="M3 7a2 2 0 012-2h13a1 1 0 011 1v2" /><path d="M3 7v11a2 2 0 002 2h14a1 1 0 001-1V9a1 1 0 00-1-1H5a2 2 0 01-2-2" /><circle cx="16.5" cy="14" r="1.2" /></>,
  "rupee-down": <><circle cx="9" cy="9" r="7" /><g strokeWidth="1.5"><path d="M6.600 5.800h5M6.600 8.200h5" /><path d="M6.600 10.600h1.500c3.100 0 3.100-4.800 0-4.800" /><path d="m6.600 10.600 3.800 3.200" /></g><path d="M19 13.500v7.500" /><path d="m16 18 3 3 3-3" /></>,
  "receipt": <><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z" /><path d="M8 7h8M8 11h8M8 15h5" /></>,
  "clipboard-list": <><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="M12 11h4M12 16h4M8 11h.01M8 16h.01" /></>,
  // more detail than the other icons, so a thinner line keeps the brim and goggles apart at nav size
  "hard-hat": <g strokeWidth="1.5"><path d="M3.6 11A8.4 8.4 0 0 1 9.93 2.86M14.07 2.86A8.4 8.4 0 0 1 20.4 11" /><path d="M10.3 7.6 9.9 2.65a.9.9 0 0 1 .9-.9h2.4a.9.9 0 0 1 .9.9l-.4 4.95" /><path d="M7.3 7.2V11M16.7 7.2V11" /><rect x="1.9" y="11" width="20.2" height="3" rx="1.2" /><path d="M3.4 17.8a1.2 1.2 0 0 1 1.2-1.2h14.8a1.2 1.2 0 0 1 1.2 1.2v3.25a1.2 1.2 0 0 1-1.2 1.2H14.6L12 20.2l-2.6 2.05H4.6a1.2 1.2 0 0 1-1.2-1.2z" /><path d="M1.6 18.4h1.8M20.6 18.4h1.8" /></g>,
  "wrench": <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z" />,
  box: <><rect x="7" y="3" width="10" height="9" rx="1" /><path d="M3 12h18a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z" /><path d="M12 12v9" /><path d="M10.5 3v3h3V3M5.5 12v3h3v-3M15.5 12v3h3v-3" /></>,
  wheelbarrow: <><path d="M5 9h16l-3.5 6.5H9.5z" /><path d="M9 9c1-2.6 2.8-3.8 5-3.8s4 1.2 5 3.8" /><path d="M9.5 15.5 2 12.5" /><path d="m17 15.5.7 1.6" /><circle cx="18" cy="19.5" r="2.5" /><path d="M11 15.5 10.5 22" /></>,
  pin: <><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z" /><circle cx="12" cy="10" r="2.5" /></>,
  bed: <><path d="M3 20V6" /><path d="M3 12h18v8" /><path d="M21 12V9a2 2 0 00-2-2h-8v5" /><circle cx="7" cy="9" r="1.5" /></>,
  utensils: <><path d="M4 3v7a2 2 0 002 2h1v9" /><path d="M7 3v6" /><path d="M10 3v7a2 2 0 01-2 2" /><path d="M17 3c-2 1.5-3 4-3 7 0 1.5 1 2.500 2 2.500h1V21" /></>,
  truck: <><path d="M1 3h15v13H1z" /><path d="M16 8h4l3 3v5h-7z" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></>,
  phone: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />,
  chat: <path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5.6a8.5 8.5 0 1 1 16.1-3.9z" />,
  download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /><path d="M12 15V3" /></>,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  eye: <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" /><circle cx="12" cy="12" r="3" /></>,
  "eye-off": <><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20C5 20 1 12 1 12a18.5 18.5 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" /><path d="m1 1 22 22" /></>,
  copy: <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
  "arrow-up": <path d="M12 19V5M5 12l7-7 7 7" />,
  "arrow-down": <path d="M12 5v14M19 12l-7 7-7-7" />,
  menu: <path d="M3 12h18M3 6h18M3 18h18" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  "chevron-left": <path d="m15 18-6-6 6-6" />,
  "chevron-right": <path d="m9 18 6-6-6-6" />,
  "chevron-down": <path d="m6 9 6 6 6-6" />,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
};
export function Icon({ name, className = "h-5 w-5" }: { name: AnyIcon; className?: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`shrink-0 ${className}`}>{P[name]}</svg>;
}
