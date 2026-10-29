// "Show what you had, refresh in the background" for list pages.
// A list remembers its last result for this browser tab, so opening it again (or coming back from a record) shows it at once while a fresh copy loads.
// Memory only: nothing is written to the browser's storage, a reload starts clean, and it is emptied when the signed-in person changes (see me.ts).
// Every page still reloads from the database each time it opens; this only removes the wait. After something is changed, call swrDrop() for the lists it
// affects so the next visit shows a loading state instead of briefly showing the old numbers.
const store = new Map<string, unknown>();

export const swrGet = <T,>(key: string): T | undefined => store.get(key) as T | undefined;
export const swrSet = (key: string, value: unknown) => { store.set(key, value); };
export const swrDrop = (...keys: string[]) => { keys.forEach((k) => store.delete(k)); };
export const swrClear = () => store.clear();
