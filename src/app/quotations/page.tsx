"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { itemAmount, inr, type Quote } from "@/lib/quote";

export default function QuotationsPage() {
  const [rows, setRows] = useState<Quote[]>([]); const [q, setQ] = useState(""); const [err, setErr] = useState(""); const [loading, setLoading] = useState(true);
  useEffect(() => { (async () => {
    const { data, error } = await supabase().from("quotations").select("*").order("created_at", { ascending: false });
    if (error) setErr(error.message + " — has the quotations SQL migration been run?"); setRows((data || []) as Quote[]); setLoading(false);
  })(); }, []);
  const shown = rows.filter((r) => (r.client_name + " " + r.subject + " " + (r.ref_no || "")).toLowerCase().includes(q.toLowerCase()));
  const amt = (r: Quote) => inr((r.items || []).reduce((s, i) => s + itemAmount(i), 0));
  const date = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold sm:mr-auto w-full sm:w-auto">Quotations</h1>
        <input className="inp w-full sm:!w-64" placeholder="Search client, subject, ref…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Link className="btn flex-1 sm:flex-none justify-center" href="/quote-library">Wording library</Link>
        <Link className="btn btn-primary flex-1 sm:flex-none justify-center" href="/quotations/new">+ New quotation</Link>
      </div>
      {err && <p className="warn">{err}</p>}
      <div className="space-y-2">
        {loading && <p className="card text-center text-sm text-slate-500">Loading…</p>}
        {!loading && !shown.length && !err && <p className="card text-center text-sm text-slate-500">{q ? "Nothing matches your search." : "No quotations yet."}</p>}
        {shown.map((r) => (
          <Link key={r.id} href={`/quotations/${r.id}`} className="card !p-3 flex flex-wrap items-center gap-x-4 gap-y-1 hover:bg-slate-50">
            <div className="min-w-0 flex-1 basis-64"><div className="font-semibold text-blue-800 truncate">{r.client_name}</div><div className="text-sm text-slate-600 truncate">{r.subject || "—"}</div></div>
            <div className="text-sm text-slate-500">{r.ref_no ?? "—"}</div>
            <div className="text-sm text-slate-500">{date(r.quote_date)}</div>
            <div className="text-sm font-medium w-28 sm:text-right">₹{amt(r)}</div>
            <span className={`text-xs rounded-full px-2 py-0.5 ${r.status === "issued" ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>{r.status === "issued" ? "Issued" : "Draft"}</span>
          </Link>))}
      </div>
    </div>
  );
}
