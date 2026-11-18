import { redirect } from "next/navigation";

// The doorway: where signing in and the home-screen icon arrive. The route guard (middleware) sends each person on to their role's landing page
// (nav.ts LANDING). This only answers if the guard has not already done so.
export default function Start() { redirect("/attendance"); }
