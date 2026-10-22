export const MAX_UPLOAD = 5 * 1024 * 1024;
const SKIP_BELOW = 1024 * 1024;

// Shrinks large photos in the browser (longest side 2000px, JPEG). PDFs and other files pass through untouched.
export async function prepareUpload(file: File, opts: { forceJpeg?: boolean } = {}): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif" || (!opts.forceJpeg && file.size <= SKIP_BELOW)) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, (opts.forceJpeg ? 1000 : 2000) / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    const ctx = c.getContext("2d")!; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(bmp, 0, 0, c.width, c.height);
    for (const q of [0.82, 0.7, 0.55]) {
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", q));
      if (blob && (blob.size <= SKIP_BELOW || q === 0.55 || opts.forceJpeg)) {
        if (!opts.forceJpeg && blob.size >= file.size) return file;
        return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
      }
    }
  } catch { /* unreadable format (e.g. HEIC) — fall through */ }
  return file;
}
