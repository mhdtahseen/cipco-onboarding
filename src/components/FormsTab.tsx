"use client";
import { useState } from "react";
import type { Employee } from "@/lib/types";
import { validate } from "@/lib/fields";

export default function FormsTab({ emp }: { emp: Employee }) {
  const [seal, setSeal] = useState(true); const [pan, setPan] = useState(false);
  const href = (k: string) => `/api/forms/${k}?employee=${emp.id}&seal=${seal ? 1 : 0}${pan ? "&pan=1" : ""}`;
  const warn = Object.values(validate(emp as any));
  const missing = ["father_spouse_name", "dob", "gender", "permanent_address", "aadhaar", "account_no", "ifsc", "nominee_name"].filter((k) => !(emp as any)[k]);
  const items = [
    { k: "joining", t: "Employee joining form", d: "Personal, KYC, bank, nominee & declaration (1 page)" },
    { k: "form11", t: "PF Form 11", d: "EPFO declaration form (1 page)" },
    { k: "gratuity", t: "Gratuity nomination – Form F", d: "Nomination, statement and employer certificate (2 pages)" },
    { k: "pcc", t: "Police verification form (Gujarat)", d: "Labor Identification and Verification Form, filled (2 pages)" },
    { k: "kit", t: "Complete joining kit", d: "The first three in one PDF, plus the police verification form when the project needs it" },
  ];
  return (
    <div className="card space-y-4">
      <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={seal} onChange={(e) => setSeal(e.target.checked)} /> Stamp company seal & signature (and date the employer sections)</label>
      {(missing.length > 0 || warn.length > 0) && <p className="warn">Heads-up — blank or doubtful fields: {[...missing.map((m) => m.replace(/_/g, " ")), ...warn].join("; ")}.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((i) => (
          <a key={i.k} href={href(i.k)} target="_blank" className="border border-slate-200 rounded-xl p-4 hover:bg-blue-50 block">
            <div className="font-semibold">{i.t}</div><div className="text-sm text-slate-500">{i.d}</div><div className="text-sm text-blue-700 mt-2">Open / download PDF →</div>
          </a>))}
      </div>
      <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={pan} onChange={(e) => setPan(e.target.checked)} /> Police verification form: also print the PAN (attach a copy of the PAN card). Aadhaar is always printed.</label>
      <p className="text-xs text-slate-500">Need it by hand? <a className="text-blue-700 underline" href="/api/forms/pcc-blank" target="_blank">Blank police verification form</a></p>
    </div>
  );
}
