"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import QuoteEditor from "@/components/QuoteEditor";

export default function QuotationPage() {
  const { id } = useParams<{ id: string }>();
  return (<div className="space-y-4"><Link href="/quotations" className="text-sm text-blue-700">← Quotations</Link><QuoteEditor key={id} id={id} /></div>);
}
