"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, setRemember } from "@/lib/supabase/client";

const friendly = (m: string) => /invalid login/i.test(m) ? "That email or password isn't right. Please try again." : /confirm/i.test(m) ? "Please confirm your email address first." : m;

export default function Login() {
  const [email, setEmail] = useState(""); const [pw, setPw] = useState(""); const [show, setShow] = useState(false);
  const [remember, setRem] = useState(true); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false); const router = useRouter();
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setBusy(true);
    setRemember(remember);
    const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password: pw });
    if (error) { setErr(friendly(error.message)); setBusy(false); return; }
    router.push("/"); router.refresh();
  }
  return (
    <div className="min-h-screen grid lg:grid-cols-[1.05fr_1fr]">
      <aside className="hidden lg:flex relative overflow-hidden flex-col justify-between p-12 text-white bg-gradient-to-br from-[#173f85] via-[#1e4fa3] to-[#2b6ad1]">
        <svg aria-hidden className="absolute -right-24 -bottom-24 w-[520px] h-[520px] opacity-10" viewBox="0 0 64 64"><path fill="#fff" fillRule="evenodd" d="M27.8 4h8.4l1 6.2 5.5 2.3 5.1-3.7 5.9 5.9-3.7 5.1 2.3 5.5 6.2 1v8.4l-6.2 1-2.3 5.5 3.7 5.1-5.9 5.9-5.1-3.7-5.5 2.3-1 6.2h-8.4l-1-6.2-5.5-2.3-5.1 3.7-5.9-5.9 3.7-5.1-2.3-5.5-6.2-1v-8.4l6.2-1 2.3-5.5-3.7-5.1 5.9-5.9 5.1 3.7 5.5-2.3zM32 22a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" /></svg>
        <div className="bg-white rounded-xl px-5 py-3 w-fit shadow-lg"><img src="/branding/logo.png" alt="CIPCO" className="h-10 w-auto" /></div>
        <div className="relative max-w-md">
          <h1 className="text-4xl font-bold leading-tight">Operations, onboarding and documents — in one place.</h1>
          <p className="mt-4 text-blue-100 leading-relaxed">Prepare offer and appointment letters, joining kits and employee records for Chandrika Industrial Projects Company.</p>
        </div>
        <p className="text-xs text-blue-200">Chandrika Industrial Projects Company · Authorised personnel only</p>
      </aside>

      <main className="flex items-center justify-center p-6 bg-[#f6f7fb]">
        <div className="w-full max-w-sm">
          <img src="/branding/logo.png" alt="CIPCO" className="h-10 w-auto mb-8 lg:hidden" />
          <h2 className="text-2xl font-bold text-slate-900">Welcome back</h2>
          <p className="text-sm text-slate-500 mt-1 mb-6">Sign in to CIPCO Operations</p>
          <form onSubmit={submit} className="space-y-4" noValidate={false}>
            <div><label className="lbl" htmlFor="email">Email</label>
              <input id="email" className="inp !py-2.5" type="email" autoComplete="username" autoFocus placeholder="you@cipcogroup.com" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
            <div><label className="lbl" htmlFor="pw">Password</label>
              <div className="relative">
                <input id="pw" className="inp !py-2.5 !pr-16" type={show ? "text" : "password"} autoComplete="current-password" placeholder="Your password" value={pw} onChange={(e) => setPw(e.target.value)} required />
                <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-medium text-blue-800 px-2 py-1 rounded hover:bg-blue-50" onClick={() => setShow(!show)} aria-pressed={show}>{show ? "Hide" : "Show"}</button>
              </div></div>
            <label className="flex items-center gap-2 text-sm text-slate-600 select-none cursor-pointer"><input type="checkbox" className="h-4 w-4 accent-[#1e4fa3]" checked={remember} onChange={(e) => setRem(e.target.checked)} /> Remember me on this device</label>
            {err && <div role="alert" className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</div>}
            <button className="btn btn-primary w-full justify-center !py-2.5" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
          </form>
          <p className="text-xs text-slate-400 mt-6">Forgot your password? Ask an administrator to reset it.</p>
        </div>
      </main>
    </div>
  );
}
