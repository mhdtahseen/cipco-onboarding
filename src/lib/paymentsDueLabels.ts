// Kept apart from the PDF builder (which reads font files with Node's fs) so the Payments due page, a browser component, can use it.
/** One amount owed to a payee, with the month it belongs to and when it is due. "running" = still building this month and not billed yet (not counted as owed until it is billed); "draft" = from a payroll that is not approved yet. */
export type DueItem = { month: string; label: string; total: number; paid: number; dueOn: string | null; state: "billed" | "running" | "draft" };
export type Category = "food" | "transport" | "accommodation" | "gas" | "equipment" | "salary" | "statutory";
export const CATEGORY_LABEL: Record<Category, string> = { food: "Food vendors", transport: "Transport", accommodation: "Accommodation", gas: "Gas cylinders", equipment: "Equipment hire", salary: "Salaries", statutory: "PF / ESI / PT / TDS" };
