import type { MetadataRoute } from "next";
// Private app: no crawler should index anything.
export default function robots(): MetadataRoute.Robots { return { rules: { userAgent: "*", disallow: "/" } }; }
