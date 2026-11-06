// The project last chosen on Site supplies, remembered on this phone so coming back tomorrow does not ask again.
// Only a convenience: if the project is no longer in the list, or storage is unavailable, the first project is used.
const KEY = "cipco_last_project";
export const keepProject = (id: string) => { try { localStorage.setItem(KEY, id); } catch { /* storage unavailable */ } };
export const rememberedProject = (projects: { id: string }[]): string => { try { const id = localStorage.getItem(KEY) || ""; return projects.some((p) => p.id === id) ? id : ""; } catch { return ""; } };
