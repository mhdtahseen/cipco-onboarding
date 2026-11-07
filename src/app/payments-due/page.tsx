import { redirect } from "next/navigation";

// Payments due is now the Due tab of Expenses. Old bookmarks and links land there.
export default function PaymentsDueMoved() { redirect("/expenses?tab=due"); }
