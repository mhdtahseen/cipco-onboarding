"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import type { MailTemplate } from "@/lib/types";

export default function MailTemplates() {
  const [list, setList] = useState<MailTemplate[]>([]); const [msg, setMsg] = useState("");
  async function load() { const { data } = await supabase().from("mail_templates").select("*").order("sort_order"); setList((data || []) as MailTemplate[]); }
  useEffect(() => { load(); }, []);
  const upd = (id: string, p: Partial<MailTemplate>) => setList((l) => l.map((t) => (t.id === id ? { ...t, ...p } : t)));
  async function save(t: MailTemplate) { const { error } = await supabase().from("mail_templates").update({ name: t.name, subject: t.subject, body: t.body }).eq("id", t.id); setMsg(error ? error.message : `Saved “${t.name}”`); }
  async function add() { await supabase().from("mail_templates").insert({ key: "tpl_" + Date.now().toString(36), name: "New template", subject: "Subject", body: "Dear {{first_name}},\n\n", sort_order: 100 }); await load(); }
  return (
    <div className="space-y-4">
      <div className="flex items-center"><h1 className="text-xl font-bold mr-auto">Mail templates</h1><button className="btn" onClick={add}>+ New template</button></div>
      <p className="text-sm text-slate-500">Placeholders: <code>{"{{first_name}} {{full_name}} {{designation}} {{department}} {{project}} {{site_location}} {{join_date}} {{ctc_figure}}"}</code></p>
      {msg && <p className="text-sm text-green-700">{msg}</p>}
      {list.map((t) => (
        <div key={t.id} className="card space-y-3">
          <input className="inp font-semibold" value={t.name} onChange={(e) => upd(t.id, { name: e.target.value })} />
          <div><label className="lbl">Subject</label><input className="inp" value={t.subject} onChange={(e) => upd(t.id, { subject: e.target.value })} /></div>
          <div><label className="lbl">Body</label><textarea className="inp" rows={9} value={t.body} onChange={(e) => upd(t.id, { body: e.target.value })} /></div>
          <button className="btn btn-primary" onClick={() => save(t)}>Save</button>
        </div>))}
    </div>
  );
}
