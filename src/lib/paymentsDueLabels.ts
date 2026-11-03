// Kept apart from the PDF builder (which reads font files with Node's fs) so the Payments due page, a browser component, can use it.
export type Category = "food" | "transport" | "accommodation" | "gas" | "equipment" | "salary" | "statutory";
export const CATEGORY_LABEL: Record<Category, string> = { food: "Food vendors", transport: "Transport", accommodation: "Accommodation", gas: "Gas cylinders", equipment: "Equipment hire", salary: "Salaries", statutory: "PF / ESI / PT / TDS" };
