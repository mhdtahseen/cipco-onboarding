"use client";
import { useEffect, useState } from "react";
import { loadMe } from "@/lib/me";
import { COMPANY } from "@/lib/company";

// The one page for every way a signed-in person can be stopped (no role, access removed or suspended, planned downtime, or the app being unable to check): one plain message and a way to reach an admin.
export default function NoAccess() {
  const [who, setWho] = useState(""); const [from, setFrom] = useState("");
  useEffect(() => { setFrom(new URLSearchParams(window.location.search).get("from") || ""); loadMe().then((me) => { if (me?.email) setWho(me.email); }).catch(() => { /* still fine without it */ }); }, []);
  const body = `Hello,\n\nI can't open CIPCO Operations.${who ? `\nMy login: ${who}` : ""}${from ? `\nPage I tried: ${from}` : ""}\n\nPlease check my access.\n\nThank you`;
  const mail = `mailto:${COMPANY.supportEmail}?subject=${encodeURIComponent("CIPCO Operations access")}&body=${encodeURIComponent(body)}`;
  return (
    <div className="max-w-md mx-auto card text-center space-y-3 mt-10">
      <h1 className="text-lg font-bold">You can't open this right now</h1>
      <p className="text-sm text-slate-600">Your login works, but your access isn't available at the moment. It may have been changed or removed, the app may be down for maintenance, or there may be a temporary fault. Please try again in a minute, and if it continues, contact an admin.</p>
      <div className="flex flex-wrap justify-center gap-2 pt-1">
        <a className="btn btn-primary" href={mail}>Contact admin</a>
        <a className="btn" href={from || "/"}>Try again</a>
      </div>
      <p className="text-xs text-slate-500">Or write to <a className="underline" href={mail}>{COMPANY.supportEmail}</a></p>
    </div>
  );
}
