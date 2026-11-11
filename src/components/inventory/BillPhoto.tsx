"use client";
import { useState } from "react";
import type { InvBill } from "@/lib/inventory";

// The bill's photo (or PDF), shown beside the entries so a reviewer can compare the two. The file is opened through /api/inventory/view, which checks who may read the bill.
export default function BillPhoto({ bill }: { bill: Pick<InvBill, "id" | "bill_path" | "kind"> }) {
  const [zoom, setZoom] = useState(false);
  const label = bill.kind === "no_bill" ? "Photo" : "Photo of the bill";
  if (!bill.bill_path) return <section className="card !p-3"><h2 className="text-sm font-semibold">{label}</h2><p className="text-sm text-slate-500 mt-2">{bill.kind === "no_bill" ? "No photo was attached to this entry." : "No photo has been attached yet."}</p></section>;
  const src = `/api/inventory/view?bill=${bill.id}`; const pdf = /\.pdf$/i.test(bill.bill_path);
  return (
    <section className="card !p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><h2 className="text-sm font-semibold">{label}</h2>
        <span className="ml-auto flex gap-2">{!pdf && <button className="btn btn-sm" onClick={() => setZoom(!zoom)}>{zoom ? "Fit to width" : "Zoom in"}</button>}<a className="btn btn-sm" href={src} target="_blank" rel="noreferrer">Open</a></span></div>
      <div className="rounded-xl border border-slate-200 bg-slate-50 overflow-auto max-h-[60vh] lg:max-h-[calc(100vh-9rem)]">
        {pdf ? <iframe title={label} src={src} className="w-full h-[60vh] lg:h-[calc(100vh-9rem)]" /> : <img src={src} alt={label} className={zoom ? "max-w-none w-[200%]" : "w-full"} />}
      </div>
    </section>
  );
}
