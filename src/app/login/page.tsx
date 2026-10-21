"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

export default function Login() {
  const [email, setEmail] = useState(""); const [pw, setPw] = useState(""); const [err, setErr] = useState(""); const router = useRouter();
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form className="card w-full max-w-sm space-y-4" onSubmit={async (e) => {
        e.preventDefault(); setErr("");
        const { error } = await supabase().auth.signInWithPassword({ email, password: pw });
        if (error) setErr(error.message); else { router.push("/"); router.refresh(); }
      }}>
        <div><h1 className="text-xl font-bold text-blue-900">CIPCO Onboarding</h1><p className="text-sm text-slate-500">Sign in to continue</p></div>
        <div><label className="lbl">Email</label><input className="inp" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
        <div><label className="lbl">Password</label><input className="inp" type="password" value={pw} onChange={(e) => setPw(e.target.value)} required /></div>
        {err && <p className="warn">{err}</p>}
        <button className="btn btn-primary w-full justify-center" type="submit">Sign in</button>
      </form>
    </div>
  );
}
