"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { buildVars } from "@/lib/clauses";
import { renderTemplate } from "@/lib/format";
import type { Employee, MailTemplate } from "@/lib/types";

const ATTACH: Record<string, string> = { offer: "Offer letter PDF", appointment: "Appointment letter PDF + Joining kit PDF", documents: "—", welcome: "—" };

export default function MailTab({ emp }: { emp: Employee }) {
  const [tpls, setTpls] = useState<MailTemplate[]>([]); const [key, setKey] = useState(""); const [copied, setCopied] = useState("");
  useEffect(() => { (async () => { const { data } = await supabase().from("mail_templates").select("*").order("sort_order"); const l = (data || []) as MailTemplate[]; setTpls(l); if (l[0]) setKey(l[0].key); })(); }, []);
  const vars = useMemo(() => buildVars(emp), [emp]);
  const t = tpls.find((x) => x.key === key);
  const subject = t ? renderTemplate(t.subject, vars) : ""; const body = t ? renderTemplate(t.body, vars) : "";
  const copy = async (s: string, what: string) => { await navigator.clipboard.writeText(s); setCopied(what); setTimeout(() => setCopied(""), 1500); };
  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap gap-2">{tpls.map((x) => <button key={x.key} className={`btn ${key === x.key ? "btn-primary" : ""}`} onClick={() => setKey(x.key)}>{x.name}</button>)}</div>
      {t && (<>
        <div><label className="lbl">To</label><input className="inp" readOnly value={emp.email || "(no email on record)"} /></div>
        <div><label className="lbl">Subject</label><input className="inp" readOnly value={subject} /></div>
        <div><label className="lbl">Message</label><textarea className="inp font-sans" rows={12} readOnly value={body} /></div>
        <p className="text-xs text-slate-500">Attach: {ATTACH[t.key] || "relevant PDFs"} (download from the Letters / Forms tabs).</p>
        <div className="flex flex-wrap gap-2">
          <a className="btn btn-primary" href={`mailto:${emp.email || ""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}>Open in mail app</a>
          <button className="btn" onClick={() => copy(subject, "subject")}>{copied === "subject" ? "Copied ✓" : "Copy subject"}</button>
          <button className="btn" onClick={() => copy(body, "body")}>{copied === "body" ? "Copied ✓" : "Copy message"}</button>
        </div>
      </>)}
      {!tpls.length && <p className="text-sm text-slate-500">No mail templates — run supabase/seed.sql.</p>}
    </div>
  );
}
