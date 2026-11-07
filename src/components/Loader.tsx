// The app's one loading look: a ring that turns. Page = centred in the space the page will fill; Inline = beside text or inside a button.
// It works in light and dark (it takes the text colour) and keeps turning, slowly, for people who ask for reduced motion.
export function Spinner({ size = 20, className = "" }: { size?: number; className?: string }) {
  return (
    <svg className={`cipco-spin shrink-0 ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** A loader in the middle of the content area. `label` is read out to screen readers (and shown under the ring when `showLabel`). */
export function PageLoader({ label = "Loading", showLabel = false, tall = false }: { label?: string; showLabel?: boolean; tall?: boolean }) {
  return (
    <div role="status" aria-live="polite" className={`grid place-items-center text-[#1e4fa3] ${tall ? "min-h-[60vh]" : "min-h-[40vh]"}`}>
      <div className="flex flex-col items-center gap-3"><Spinner size={36} />{showLabel ? <span className="text-sm text-slate-500">{label}…</span> : <span className="sr-only">{label}…</span>}</div>
    </div>
  );
}

export function InlineLoader({ label = "Loading" }: { label?: string }) {
  return <span role="status" className="inline-flex items-center gap-2 text-sm text-slate-500"><Spinner size={16} />{label}…</span>;
}
