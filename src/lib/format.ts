const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export function fmtDateLong(d?: string | Date | null): string {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d + (d.length === 10 ? "T00:00:00" : "")) : d;
  if (isNaN(dt.getTime())) return "";
  return `${MONTHS[dt.getMonth()]} ${dt.getDate()}, ${dt.getFullYear()}`;
}
export function fmtDateDMY(d?: string | Date | null, sep = "/"): string {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d + (d.length === 10 ? "T00:00:00" : "")) : d;
  if (isNaN(dt.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(dt.getDate())}${sep}${p(dt.getMonth() + 1)}${sep}${dt.getFullYear()}`;
}
export function dmyParts(d?: string | null) {
  if (!d) return { dd: "", mm: "", yyyy: "" };
  const [y, m, dd] = d.split("-");
  return { dd, mm: m, yyyy: y };
}
export function todayISO() { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }

const ONES = ["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"];
const TENS = ["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];
function two(n: number) { return n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? "-" + ONES[n % 10] : ""); }
function three(n: number) { const h = Math.floor(n / 100), r = n % 100; return (h ? ONES[h] + " Hundred" + (r ? " " : "") : "") + (r ? two(r) : ""); }
/** Indian numbering: 25000 -> "Twenty-Five Thousand" */
export function numToWordsIN(n: number): string {
  n = Math.round(n); if (n === 0) return "Zero";
  const parts: string[] = [];
  const cr = Math.floor(n / 1e7); n %= 1e7;
  const lk = Math.floor(n / 1e5); n %= 1e5;
  const th = Math.floor(n / 1e3); n %= 1e3;
  if (cr) parts.push(three(cr) + " Crore");
  if (lk) parts.push(two(lk) + " Lakh");
  if (th) parts.push(two(th) + " Thousand");
  if (n) parts.push(three(n));
  return parts.join(" ");
}
export function fmtINR(n: number): string { return "₹" + Math.round(n).toLocaleString("en-IN") + "/-"; }

const SMALL = ["zero","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve"];
export function probationText(m?: number | null): string {
  if (!m) return "";
  const w = m <= 12 ? SMALL[m] : String(m);
  return `${w} (${m}) month${m === 1 ? "" : "s"}`;
}

/** Replace {{key}} using vars; unknown keys stay visible so mistakes are noticed. */
export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k) => (k in vars ? vars[k] : m));
}
