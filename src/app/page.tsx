import { redirect } from "next/navigation";

// The plain address (and the home-screen icon) is a doorway, not a page: the route guard (middleware) sends each person to their role's landing page
// (nav.ts LANDING, Attendance for everyone today). This only answers if the guard has not already done so.
export default function Home() { redirect("/attendance"); }
