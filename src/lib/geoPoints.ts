// Shared by the Locations page and its map. Kept apart from the map component so the page never loads the map library on the server.
export type GeoPoint = { id: string; lat: number; lng: number; acc: number | null; at: string; who: string; role: string; project: string; action: string; subject: string | null; workDate: string | null };
export const ACTION_COLOR: Record<string, string> = { attendance: "#2563eb", meal: "#ea580c", bulk: "#4f46e5", transport: "#0d9488", submit: "#16a34a", verify: "#9333ea", reopen: "#dc2626" };
