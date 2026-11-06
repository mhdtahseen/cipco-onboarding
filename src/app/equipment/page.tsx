import { redirect } from "next/navigation";
// Hired equipment moved to Site supplies; old links and bookmarks still arrive.
export default function EquipmentMoved() { redirect("/site-supplies"); }
