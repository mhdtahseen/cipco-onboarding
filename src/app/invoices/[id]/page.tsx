"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import InvoiceView from "@/components/invoices/InvoiceView";

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  return (<div className="space-y-4"><Link href="/invoices" className="text-sm text-blue-700">← Invoices</Link><InvoiceView key={id} id={id} /></div>);
}
