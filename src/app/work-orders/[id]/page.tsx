"use client";
import Link from "next/link";
import { Suspense } from "react";
import { useParams } from "next/navigation";
import WorkOrderEditor from "@/components/invoices/WorkOrderEditor";

export default function WorkOrderPage() {
  const { id } = useParams<{ id: string }>();
  return (<div className="space-y-4"><Link href="/work-orders" className="text-sm text-blue-700">← Work orders</Link><Suspense fallback={<p className="text-slate-500">Loading…</p>}><WorkOrderEditor key={id} id={id} /></Suspense></div>);
}
