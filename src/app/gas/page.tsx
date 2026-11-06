import { redirect } from "next/navigation";
// Gas cylinders moved to Site supplies; old links and bookmarks still arrive.
export default function GasMoved() { redirect("/site-supplies"); }
