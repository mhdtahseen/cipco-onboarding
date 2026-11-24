// The in-app file viewer (components/viewer/FileViewer.tsx, mounted once in the layout). Bills, documents, photos and the PDFs the app makes open in a
// window over the page instead of a new tab. Any screen can call openViewer(); plain links to a viewable file are caught automatically.
//  - <a href="/api/docs/view?path=…">  opens in the viewer. Ctrl/⌘/Shift-click, middle-click, a download attribute or data-viewer="off" keep the old way.
//  - data-view-group="x" on several links: the viewer steps through all of them (Aadhaar front and back, every bill in a list).
//  - data-view-name="Aadhaar front": the name shown and used for downloads.
export type ViewFile = { src: string; name?: string; kind?: "pdf" | "image" };

type Listener = (files: ViewFile[], start: number) => void;
let listener: Listener | null = null;
const queued: [ViewFile[], number][] = [];
export function onOpenViewer(fn: Listener) { listener = fn; queued.splice(0).forEach(([f, s]) => fn(f, s)); return () => { if (listener === fn) listener = null; }; }
export function openViewer(files: ViewFile | ViewFile[], start = 0) {
  const list = Array.isArray(files) ? files : [files]; if (!list.length) return;
  if (listener) listener(list, start); else queued.push([list, start]);
}

// Stored files: the route says where the file is (meta=1). Files the app makes: read straight from the route.
const STORED = [/^\/api\/docs\/view$/, /^\/api\/gas\/file$/, /^\/api\/inventory\/view$/, /^\/api\/bills\/file$/, /^\/api\/company\/file$/, /^\/api\/payroll\/advance-proof$/];
const MADE = [/^\/api\/letters\/[^/]+\/pdf$/, /^\/api\/quotations\/[^/]+\/pdf$/, /^\/api\/payslips\/[0-9a-f-]{36}$/, /^\/api\/payments-due\/pdf$/, /^\/api\/vendor-statement$/,
  /^\/api\/tools\/transfer\/[^/]+$/, /^\/api\/payroll-bank-letter$/, /^\/api\/invoices\/[0-9a-f-]{36}$/];
export const isStored = (u: URL) => STORED.some((r) => r.test(u.pathname));
/** A link the viewer can show: same site, a file route, not a download. */
export function viewableUrl(href: string): URL | null {
  if (typeof window === "undefined") return null;
  let u: URL; try { u = new URL(href, window.location.href); } catch { return null; }
  if (u.origin !== window.location.origin || u.searchParams.get("dl") === "1" || u.searchParams.get("raw") === "1") return null;
  return STORED.some((r) => r.test(u.pathname)) || MADE.some((r) => r.test(u.pathname)) ? u : null;
}
