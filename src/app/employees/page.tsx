import { Suspense } from "react";
import EmployeeList from "@/components/employees/EmployeeList";

// The list reads its filters from the address bar, which Next requires to sit inside a Suspense boundary.
export default function Dashboard() {
  return <Suspense fallback={<div className="space-y-3"><div className="skeleton h-8 w-48" /><div className="skeleton h-10 w-full" /><div className="skeleton h-64 w-full" /></div>}><EmployeeList /></Suspense>;
}
