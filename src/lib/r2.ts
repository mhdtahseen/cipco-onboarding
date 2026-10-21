import { AwsClient } from "aws4fetch";

// Cloudflare R2 over its S3-compatible API (works on Node and on Workers).
const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`Missing env ${k}`); return v; };
const client = () => new AwsClient({ accessKeyId: need("R2_ACCESS_KEY_ID"), secretAccessKey: need("R2_SECRET_ACCESS_KEY"), service: "s3", region: "auto" });
const objectUrl = (key: string) => `https://${need("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com/${need("R2_BUCKET")}/${key.split("/").map(encodeURIComponent).join("/")}`;

export async function r2Put(key: string, body: ArrayBuffer, contentType: string) {
  const r = await client().fetch(objectUrl(key), { method: "PUT", body, headers: { "Content-Type": contentType } });
  if (!r.ok) throw new Error(`R2 upload failed: ${r.status} ${await r.text()}`);
}

export async function r2SignedGetUrl(key: string, seconds = 120) {
  const u = new URL(objectUrl(key)); u.searchParams.set("X-Amz-Expires", String(seconds));
  const s = await client().sign(u.toString(), { method: "GET", aws: { signQuery: true } });
  return s.url;
}
