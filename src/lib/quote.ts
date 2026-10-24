import { COMPANY } from "./company";

export type QItem = { desc: string; qty: string; unit: string; note: string; rate: string; lump: boolean; amount: string };
export type QTerm = { label: string; value: string };
export type Quote = {
  id?: string; ref_no: string | null; status: "draft" | "issued"; quote_date: string;
  client_name: string; client_short: string; client_address: string; kind_attn: string; subject: string; intro: string;
  items: QItem[]; show_total: boolean; show_gst: boolean; notes: string[]; terms: QTerm[];
  include_scope: boolean; scope: string[]; client_supply: string[]; our_supply: string[]; signatory: string;
  created_at?: string; updated_at?: string;
};
export type LibKind = "scope" | "client_supply" | "our_supply" | "note" | "payment_terms";
export type QLib = { id: string; kind: LibKind; tag: string | null; body: string; default_on: boolean; sort_order: number; active: boolean };

export const GST_RATE = 0.18;
export const DEFAULT_INTRO = "We acknowledge with thanks the receipt of your verbal enquiry for the above subject. We are pleased to quote our lowest offer for the same. If you require any further clarification, please feel free to contact us.";
export const BLANK_ITEM: QItem = { desc: "", qty: "", unit: "MT", note: "", rate: "", lump: false, amount: "" };
export const DEFAULT_TERMS: QTerm[] = [
  { label: "GSTIN", value: "18% Extra" }, { label: "TDS", value: "1% Extra" }, { label: "Payment Terms", value: "" },
  { label: "Completion Period", value: "3 Months from the Date of Start of Work." }, { label: "Mobilisation Period", value: "1 Month from the Date of Issue of PO" },
];
export const emptyQuote = (today: string): Quote => ({
  ref_no: null, status: "draft", quote_date: today, client_name: "", client_short: "", client_address: "", kind_attn: "", subject: "", intro: DEFAULT_INTRO,
  items: [{ ...BLANK_ITEM }], show_total: false, show_gst: false, notes: [], terms: DEFAULT_TERMS.map((t) => ({ ...t })),
  include_scope: false, scope: [], client_supply: [], our_supply: [], signatory: COMPANY.quoteSignatory,
});

const num = (s: string) => { const n = Number(String(s).replace(/,/g, "")); return Number.isFinite(n) ? n : 0; };
export const itemAmount = (i: QItem) => (i.lump ? num(i.amount) : num(i.qty) * num(i.rate));
export const inr = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
export const money = (n: number) => `₹${inr(n)}/-`;
export function totals(items: QItem[]) { const total = items.reduce((s, i) => s + itemAmount(i), 0); const gst = Math.round(total * GST_RATE * 100) / 100; return { total, gst, grand: total + gst }; }
export const fillClient = (t: string, q: Pick<Quote, "client_name" | "client_short">) => t.replace(/\{\{\s*client\s*\}\}/gi, q.client_short.trim() || q.client_name);
