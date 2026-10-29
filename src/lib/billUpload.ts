import { MAX_UPLOAD, prepareUpload } from "@/lib/compress";

/** Uploads a bill / receipt photo or PDF for a project and returns where it was stored. */
export async function uploadBill(picked: File, projectId: string): Promise<{ path: string } | { error: string }> {
  const file = await prepareUpload(picked);
  if (file.size > MAX_UPLOAD) return { error: "The bill is larger than 5 MB: please send a smaller photo or compressed PDF." };
  const fd = new FormData(); fd.set("file", file); fd.set("employeeId", `proj-${projectId}`); fd.set("docType", "expense");
  const r = await fetch("/api/docs/upload", { method: "POST", body: fd });
  if (!r.ok) return { error: await r.text() };
  return { path: (await r.json()).path };
}
