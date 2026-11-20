"use client";
import { useRole } from "@/lib/roles";
import { PageLoader } from "@/components/Loader";
import PdfWorkspace from "@/components/pdf/PdfWorkspace";

// PDF & scan (Admin only; the route guard keeps everyone else out). See components/pdf/PdfWorkspace.tsx.
export default function PdfPage() {
  const { role } = useRole();
  if (!role) return <PageLoader />;
  if (role !== "admin") return <p className="text-slate-500">PDF &amp; scan is for Admins.</p>;
  return <PdfWorkspace />;
}
