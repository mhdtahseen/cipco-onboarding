import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// The server's clock, for the profile menu ("Server time"). The app's rules (reminders, the 08:30 JSL send, which day an entry belongs to) run on this clock in
// India time, not on the phone's. Admin and Operations only (nav.ts).
export function GET() { return NextResponse.json({ now: Date.now() }, { headers: { "cache-control": "no-store" } }); }
