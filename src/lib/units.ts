/** The units the JSL portal accepts, spelled exactly as its dropdown spells them. Inventory, the portal robot and the database all use exactly this list. */
export const JSL_UNITS = ["FT", "Inch", "Kg", "Meter", "mm", "MT", "No", "Pcs"];
/** The units offered everywhere else (quotations, work orders, invoices). It starts as the JSL list: add a unit here to offer it across the app. Inventory stays on JSL_UNITS. */
export const UNITS = [...JSL_UNITS];
export const DEFAULT_UNIT = "No";
