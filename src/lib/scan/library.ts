// Saved files: everything PDF & scan makes is kept here for later, in the browser's own storage (IndexedDB) on this device. Nothing goes to the
// server, so a file saved on the laptop is not on the phone, and clearing the browser's site data removes them.
export type SavedFile = { id: string; name: string; type: string; size: number; created: number; blob: Blob };
const DB = "cipco_pdf", STORE = "files";

function open(): Promise<IDBDatabase> {
  return new Promise((ok, no) => {
    const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: "id" }); };
    r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error ?? new Error("Saved files are not available in this browser."));
  });
}
async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((ok, no) => { const tx = db.transaction(STORE, mode); const rq = fn(tx.objectStore(STORE)); rq.onsuccess = () => ok(rq.result); rq.onerror = () => no(rq.error); tx.oncomplete = () => db.close(); });
}

const listeners = new Set<() => void>();
/** Tells open screens that the saved files changed. */
export function onLibraryChange(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
const changed = () => listeners.forEach((f) => f());

export async function saveToLibrary(file: File): Promise<void> {
  const rec: SavedFile = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, name: file.name, type: file.type, size: file.size, created: Date.now(), blob: file };
  await run("readwrite", (s) => s.put(rec)); changed();
}
/** Newest first. */
export async function listLibrary(): Promise<SavedFile[]> { const all = await run<SavedFile[]>("readonly", (s) => s.getAll()); return all.sort((a, b) => b.created - a.created); }
export async function renameSaved(f: SavedFile, name: string) { await run("readwrite", (s) => s.put({ ...f, name })); changed(); }
export async function deleteSaved(id: string) { await run("readwrite", (s) => s.delete(id)); changed(); }
export async function clearLibrary() { await run("readwrite", (s) => s.clear()); changed(); }
export const asFile = (f: SavedFile) => new File([f.blob], f.name, { type: f.type, lastModified: f.created });
