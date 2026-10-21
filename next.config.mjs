/** @type {import('next').NextConfig} */
const nextConfig = {
  // PDF templates, fonts and the Excel template are read from /assets at runtime
  outputFileTracingIncludes: { "/api/**/*": ["./assets/**/*", "./public/branding/**/*"] },
  serverExternalPackages: ["pdf-lib", "exceljs"],
};
export default nextConfig;
