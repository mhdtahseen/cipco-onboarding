"use client";
import Logo from "@/components/Logo";
import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { MAX_UPLOAD, prepareUpload } from "@/lib/compress";
import { FIELD_GROUPS, validate, withPoliceStation, type FieldDef } from "@/lib/fields";
import { usePoliceLists } from "@/lib/policeStations";
import ListPick from "@/components/ListPick";
import { DEFAULT_LANG, LANGS, NON_ENGLISH, en, isLang, loadDict, makeT, stripNonEnglish, type Dict, type LangCode } from "@/lib/apply-i18n";
import { PageLoader } from "@/components/Loader";

// Public page: the candidate fills in their own details. Talks to Supabase only through the invite_* functions.
// The page can be shown in any language in LANGS, but every answer is typed in English: the wording changes, the saved values never do.
const GROUPS = [
  { title: "Your name", tk: "s.name", fields: FIELD_GROUPS[0].fields.filter((f) => f.key === "full_name") },
  ...FIELD_GROUPS.slice(1).map((g) => ({ ...g, tk: `s.${({ Personal: "personal", Family: "family", Address: "address", "Statutory & bank": "statutory", "Nominee & emergency contact": "nominee" } as Record<string, string>)[g.title] ?? "personal"}` })),
];
// A project that needs police verification (the Gujarat PCC form) also asks for the police station of the permanent address, right after PIN
// (State → District → City → PIN → police station). invite_get says so (needs_pcc); before 2026-11-invite-police-station.sql is run it never does.
const PCC_FIELD: FieldDef = { key: "native_police_station", label: "Police station of permanent address", wide: true };
const withPcc = (gs: typeof GROUPS) => gs.map((g) => g.tk !== "s.address" ? g : { ...g, fields: withPoliceStation(g.fields, PCC_FIELD) });
const PICKED = new Set(["state", "district", "native_police_station"]);   // picked from the police-station lists when they are loaded
const UPLOADS = [{ key: "aadhaar", hint: true }, { key: "pan" }, { key: "bank" }, { key: "photo", hint: true }, { key: "uan", hint: true }, { key: "resume" }];
// On a phone, short fields share a row two at a time; everything else takes the full width. Tablets and up use two columns throughout.
const HALF = new Set(["father_spouse_type", "dob", "gender", "marital_status", "religion", "blood_group", "city", "district", "state", "pin", "nominee_relation", "nominee_age_dob"]);
const AUTO: Record<string, string> = { email: "email", phone: "tel", alt_phone: "tel", full_name: "name", permanent_address: "street-address", city: "address-level2", state: "address-level1", pin: "postal-code" };
const MAXLEN: Record<string, number> = { phone: 10, alt_phone: 10, nominee_phone: 10, emergency_phone: 10, pin: 6, aadhaar: 14, pan: 10, ifsc: 11, uan: 14 };
const LANG_KEY = "cipco_apply_lang";
/** A value already on file, hidden except its last 4 characters: "•••• •••• 1234" for Aadhaar, "•••• 1234" for the rest. Only the last 4 ever reach this page. */
const maskOf = (key: string, last4: string) => (key === "aadhaar" ? `•••• •••• ${last4}` : `•••• ${last4}`);
const nice = (p?: string) => (p ? p.split("/").pop()!.replace(/^\d+-/, "") : "");

export default function ApplyPage() {
  const { token } = useParams<{ token: string }>();
  const [inv, setInv] = useState<any>(null); const [state, setState] = useState<"loading" | "bad" | "form" | "done" | "applied">("loading");
  const [v, setV] = useState<Record<string, string>>({}); const [files, setFiles] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(""); const [err, setErr] = useState(""); const [ok, setOk] = useState(false); const [onFile, setOnFile] = useState<string[]>([]); const [masked, setMasked] = useState<Record<string, string>>({}); const [changing, setChanging] = useState<Set<string>>(new Set());
  const confirmRef = useRef<HTMLInputElement>(null); const [nudge, setNudge] = useState(false);
  // language: English until they choose; the first visit asks, later visits remember the choice and the header button changes it
  const [lang, setLang] = useState<LangCode>(DEFAULT_LANG); const [dict, setDict] = useState<Dict>(en); const [seen, setSeen] = useState(true); const [picking, setPicking] = useState(false);
  const [enKey, setEnKey] = useState(""); const enTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const t = makeT(dict);
  useEffect(() => { try { const s = localStorage.getItem(LANG_KEY); if (isLang(s)) setLang(s); else setSeen(false); } catch { setSeen(false); } }, []);
  useEffect(() => { let live = true; loadDict(lang).then((d) => { if (live) setDict(d); }).catch(() => { /* English stays */ }); document.documentElement.lang = lang; return () => { live = false; }; }, [lang]);
  const chooseDone = () => { try { localStorage.setItem(LANG_KEY, lang); } catch { /* storage unavailable */ } setSeen(true); setPicking(false); window.scrollTo(0, 0); };

  useEffect(() => { (async () => {
    const { data } = await supabase().rpc("invite_get", { p_token: token });
    if (!data) { setState("bad"); return; }
    setInv(data); setFiles(data.files || {});
    setV({ father_spouse_type: "Father", full_name: data.name || "", phone: data.phone || "", email: data.email || "", ...(data.prefill || {}), ...(data.submission || {}) });
    setOnFile(data.on_file || []); setMasked(data.on_file_masked || {});
    setState(data.status === "applied" ? "applied" : "form");
  })(); }, [token]);
  const warn = validate(v);
  const groups = inv?.needs_pcc ? withPcc(GROUPS) : GROUPS;
  // State → District → police station: changing the State or District clears what depends on it
  const ps = usePoliceLists(v.state, v.district);
  const pick = (k: string, x: string) => setV((p) => ({ ...p, [k]: x,
    ...(k === "state" && x !== p.state ? { district: "", native_police_station: "" } : {}), ...(k === "district" && x !== p.district ? { native_police_station: "" } : {}) }));
  // every typed answer goes through here: anything that is not English (another script) is dropped and a short reminder shows under that field
  const set = (k: string, x: string) => {
    if (NON_ENGLISH.test(x)) { x = stripNonEnglish(x); setEnKey(k); clearTimeout(enTimer.current); enTimer.current = setTimeout(() => setEnKey(""), 5000); }
    setV((p) => ({ ...p, [k]: x }));
  };
  const labelOf = (key: string, fallback: string) => t(`f.${key}`) === `f.${key}` ? fallback : t(`f.${key}`);

  async function upload(doc: string, picked: File) {
    setErr(""); const file = await prepareUpload(picked, { forceJpeg: doc === "photo" });
    if (file.size > MAX_UPLOAD) { setErr(t("e.big")); return; }
    setBusy(doc);
    const fd = new FormData(); fd.set("file", file); fd.set("token", token); fd.set("docType", doc);
    const r = await fetch("/api/apply/upload", { method: "POST", body: fd });
    setBusy("");
    if (!r.ok) { setErr(await r.text()); return; }
    setFiles((p) => ({ ...p, [doc]: file.name }));
  }
  async function submit() {
    setErr("");
    if (!v.full_name?.trim()) { setErr(t("e.name")); return; }
    const bad = groups.flatMap((g) => g.fields).find((f) => NON_ENGLISH.test(v[f.key] ?? ""));   // an old answer on file in another script
    if (bad) { setErr(t("e.english", { field: labelOf(bad.key, bad.label) })); return; }
    if (!ok) {   // take them to the tick box, which is far below on a phone, and flash it so it is obvious what is missing
      setErr(t("e.tick"));
      // after the error has appeared in the bar (it makes the bar taller), so the scroll lands clear of it; the label's bottom margin keeps it above the Submit bar
      setTimeout(() => {
        confirmRef.current?.closest("label")?.scrollIntoView({ behavior: "smooth", block: "end" });
        confirmRef.current?.focus({ preventScroll: true });
      }, 60);
      setNudge(true); setTimeout(() => setNudge(false), 2200); return;
    }
    setBusy("submit");
    const { data } = await supabase().rpc("invite_submit", { p_token: token, p_data: v });
    setBusy("");
    if (!data) { setErr(t("e.expired")); return; }
    setState("done"); window.scrollTo(0, 0);
  }

  const cur = LANGS.find((l) => l.code === lang)!;
  const shell = (c: React.ReactNode, showLang = true) => <div className="apply min-h-screen px-4 sm:px-6 pt-[max(16px,env(safe-area-inset-top))] sm:pt-8"><div className="max-w-2xl mx-auto space-y-4 pb-4"><div className="flex items-center gap-3"><Logo className="h-8 w-auto" /><span className="text-sm font-semibold text-slate-500 flex-1 min-w-0 truncate">{t("joining")}</span>
    {showLang && <button type="button" className="btn !px-3 shrink-0" onClick={() => setPicking(true)} aria-label={`${t("lang.change")}: ${cur.english}`}><span aria-hidden>🌐</span><span>{cur.native}</span></button>}</div>{c}</div></div>;
  const allKeys = groups.flatMap((g) => g.fields.map((f) => f.key)).filter((k) => k !== "father_spouse_type");
  const filled = allKeys.filter((k) => String(v[k] ?? "").trim() || onFile.includes(k)).length + UPLOADS.filter((u) => files[u.key]).length, total = allKeys.length + UPLOADS.length;

  if (state === "loading") return shell(<PageLoader />, false);
  if (state === "bad") return shell(<div className="card"><h1 className="font-bold text-lg">{t("bad.t")}</h1><p className="text-sm text-slate-600 mt-1">{t("bad.b")}</p></div>);
  if (state === "applied") return shell(<div className="card"><h1 className="font-bold text-lg">{t("done0.t")}</h1><p className="text-sm text-slate-600 mt-1">{t("done0.b")}</p></div>);
  if (state === "done") return shell(<div className="card space-y-2"><h1 className="font-bold text-lg">{t("done.t", { name: v.full_name?.split(" ")[0] ?? "" })}</h1><p className="text-sm text-slate-600">{t("done.b")}</p><button className="btn" onClick={() => setState("form")}>{t("edit")}</button></div>);

  // the language chooser: shown on the first visit, and again from the header button. Tapping a language switches the whole page at once; Continue goes on to the form.
  if (!seen || picking) return shell(<>
    <div className="card !p-4 sm:!p-5 space-y-3">
      <div><h1 className="text-xl font-bold">{t("lang.title")}</h1><p className="text-sm text-slate-500 mt-1">{t("lang.sub")}</p></div>
      <div className="grid grid-cols-2 gap-2.5" role="radiogroup" aria-label={t("lang.title")}>
        {LANGS.map((l) => <button key={l.code} type="button" role="radio" aria-checked={lang === l.code} onClick={() => setLang(l.code)}
          className={`rounded-xl border-2 px-3 py-3 text-left min-h-[64px] transition-colors ${lang === l.code ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
          <div className="text-lg font-semibold leading-snug">{l.native}</div><div className="text-xs text-slate-500">{l.english}{lang === l.code ? " ✓" : ""}</div></button>)}
      </div>
    </div>
    <div className="sticky bottom-0 z-10 -mx-4 px-4 sm:-mx-6 sm:px-6 border-t border-slate-200 bg-[#f6f7fb] pt-2.5 pb-[max(12px,env(safe-area-inset-bottom))]"><button className="btn btn-primary w-full justify-center" onClick={chooseDone}>{t("lang.continue")}</button></div>
  </>, false);

  return shell(<>
    <div><h1 className="text-xl font-bold">{inv?.name ? t("helloName", { name: inv.name.split(" ")[0] }) : t("hello")} 👋</h1>
      <p className="text-sm text-slate-500">{t("intro")}</p></div>
    {lang !== "en" && <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{t("enNote")}</p>}
    {groups.map((g) => (
      <section key={g.title} className="card !p-4 sm:!p-5">
        <h3 className="font-semibold mb-3">{t(g.tk)}</h3>
        <div className="grid gap-x-3 gap-y-3.5 grid-cols-2">
          {g.fields.map((f) => (
            <div key={f.key} className={`min-w-0 ${f.wide ? "col-span-2" : HALF.has(f.key) ? "col-span-1" : "col-span-2 sm:col-span-1"}`}>
              <label className="lbl" htmlFor={f.key}>{labelOf(f.key, f.label)}</label>
              {onFile.includes(f.key) && masked[f.key] !== undefined && !changing.has(f.key) && !String(v[f.key] ?? "").trim()
                ? <div className="flex items-center gap-2"><div id={f.key} className="inp flex items-center justify-between !bg-slate-50 text-slate-600 tracking-wide" aria-label={`${labelOf(f.key, f.label)}, ${t("onFile")}, ${masked[f.key] ? `…${masked[f.key]}` : ""}`}><span>{masked[f.key] ? maskOf(f.key, masked[f.key]) : "••••••••"}</span><span className="text-xs text-green-700 ml-2 shrink-0">✓ {t("onFile")}</span></div><button type="button" className="btn shrink-0" onClick={() => setChanging((x) => new Set(x).add(f.key))}>{t("change")}</button></div>
                : PICKED.has(f.key) && ps.ready ? <ListPick id={f.key} lang="en" value={v[f.key]} options={f.key === "state" ? ps.states : f.key === "district" ? ps.districts : ps.stations} onChange={(x) => pick(f.key, stripNonEnglish(x))} other={t("ps.other")} back={t("ps.back")} />
                : f.type === "select" ? <select id={f.key} className="inp" value={v[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)}><option value=""></option>{f.options!.map((o) => <option key={o} value={o}>{t(`o.${o}`)}</option>)}</select>
                : f.type === "textarea" ? <textarea id={f.key} className="inp" rows={2} lang="en" autoComplete={AUTO[f.key] ?? "off"} value={v[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} />
                : <input id={f.key} className="inp" lang="en" type={f.type === "date" ? "date" : f.key === "email" ? "email" : "text"} inputMode={f.key === "email" ? "email" : ["phone", "alt_phone", "nominee_phone", "emergency_phone"].includes(f.key) ? "tel" : ["pin", "aadhaar", "account_no", "uan"].includes(f.key) ? "numeric" : undefined} autoComplete={AUTO[f.key] ?? "off"} maxLength={MAXLEN[f.key]} enterKeyHint="next" autoCapitalize={["pan", "ifsc"].includes(f.key) ? "characters" : undefined} placeholder={onFile.includes(f.key) ? t("onFilePh") : undefined} value={v[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} />}
              {enKey === f.key && <p className="warn" role="alert">{t("enOnly")}</p>}
              {warn[f.key] && <p className="warn">{t(`w.${f.key}`) === `w.${f.key}` ? warn[f.key] : t(`w.${f.key}`)}</p>}
            </div>))}
        </div>
      </section>))}
    <div className="card !p-4 sm:!p-5">
      <h3 className="font-semibold mb-1">{t("s.documents")}</h3><p className="text-xs text-slate-500 mb-3">{t("d.hint")}</p>
      <div className="divide-y divide-slate-100">{UPLOADS.map((u) => (
        <div key={u.key} className="py-3 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-0 basis-40"><div className="text-sm font-medium">{t(`u.${u.key}`)}</div>{u.hint && <div className="text-xs text-slate-400">{t(`u.${u.key}.h`)}</div>}</div>
          {files[u.key] && <span className="text-xs text-green-700 truncate max-w-[10rem] order-last w-full sm:order-none sm:w-auto" title={nice(files[u.key])}>✓ {nice(files[u.key])}</span>}
          <label className="btn cursor-pointer">{busy === u.key ? t("d.uploading") : files[u.key] ? t("d.replace") : t("d.upload")}
            <input type="file" className="hidden" accept="image/*,.pdf" disabled={!!busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(u.key, f); }} /></label>
        </div>))}</div>
    </div>
    <label style={{ scrollMarginBottom: 180 }} className={`flex items-start gap-3 text-sm text-slate-600 rounded-xl p-2 -mx-2 -mt-2 transition-colors ${nudge ? "bg-amber-50 ring-2 ring-amber-400" : ""}`}><input ref={confirmRef} type="checkbox" className="mt-0.5" checked={ok} onChange={(e) => { setOk(e.target.checked); if (e.target.checked) setErr(""); }} />{t("consent")}</label>
    {/* the bar stays on screen while scrolling: progress, any error from the last tap, and Submit (kept clear of the iPhone home bar) */}
    <div className="sticky bottom-0 z-10 -mx-4 px-4 sm:-mx-6 sm:px-6 border-t border-slate-200 bg-[#f6f7fb] pt-2.5 pb-[max(12px,env(safe-area-inset-bottom))] space-y-2">
      {err && <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
      <div className="flex items-center gap-3">
        <div className="shrink-0 text-xs text-slate-500 leading-tight"><b className="text-slate-700">{t("of", { n: filled, total })}</b><br />{t("filled")}</div>
        <button className="btn btn-primary flex-1 justify-center" disabled={!!busy} onClick={submit}>{busy === "submit" ? t("sending") : t("submit")}</button>
      </div>
    </div>
  </>);
}
