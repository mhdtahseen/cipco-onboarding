"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { onOpenViewer, openViewer, viewableUrl, type ViewFile } from "@/lib/viewer";

// The in-app file viewer: bills, documents, photos and the app's own PDFs open in a window over the page (full screen on a phone) instead of a new tab.
// Mounted once in the layout and tiny: it catches clicks on links to viewable files (see lib/viewer.ts) and answers openViewer() from any screen.
// The window itself (ViewerWindow.tsx: pdf.js, zoom, share…) is only downloaded the first time a file is opened.
//  - Images: zoom and rotate. PDFs: drawn page by page with pdf.js (the browser's own PDF view shows one page on iPhones and none on Android),
//    zoom, rotate, page count, locked PDFs with their password.
//  - Several files (data-view-group): previous / next, arrow keys, swipe.
//  - Esc or the phone's Back button closes it; Download, Share (phones) and Open in a new tab are always there.
const ViewerWindow = dynamic(() => import("./ViewerWindow"), { ssr: false, loading: () => <div className="fixed inset-0 z-[90] grid place-items-center bg-[#0b1220]"><div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white" /></div> });

export default function FileViewer() {
  const [files, setFiles] = useState<ViewFile[] | null>(null); const [index, setIndex] = useState(0);
  const pushed = useRef(false);
  const open = useCallback((f: ViewFile[], s: number) => { setFiles(f); setIndex(Math.min(Math.max(0, s), f.length - 1)); }, []);
  useEffect(() => onOpenViewer(open), [open]);

  // links to viewable files open here
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.hasAttribute("download") || a.dataset.viewer === "off" || !viewableUrl(a.href)) return;
      e.preventDefault(); e.stopPropagation();
      const g = a.dataset.viewGroup;
      const list = g ? Array.from(document.querySelectorAll<HTMLAnchorElement>(`a[data-view-group="${CSS.escape(g)}"]`)).filter((x) => viewableUrl(x.href)) : [a];
      openViewer(list.map((x) => ({ src: x.href, name: x.dataset.viewName || undefined })), Math.max(0, list.indexOf(a)));
    };
    document.addEventListener("click", onClick, true); return () => document.removeEventListener("click", onClick, true);
  }, []);

  // the phone's Back button closes the viewer instead of leaving the page
  useEffect(() => {
    if (!files) return;
    if (!pushed.current) { history.pushState({ ...(history.state || {}), cipcoViewer: true }, ""); pushed.current = true; }
    const onPop = () => { pushed.current = false; setFiles(null); };
    window.addEventListener("popstate", onPop); return () => window.removeEventListener("popstate", onPop);
  }, [files]);
  const close = useCallback(() => { if (pushed.current) { pushed.current = false; history.back(); } setFiles(null); }, []);

  if (!files) return null;
  return createPortal(<ViewerWindow files={files} index={index} setIndex={setIndex} onClose={close} />, document.body);
}

