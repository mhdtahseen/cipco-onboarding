/** @type {import('next').NextConfig} */
const nextConfig = {
  // PDF templates, fonts and the Excel template are read from /assets at runtime
  outputFileTracingIncludes: { "/api/**/*": ["./assets/**/*", "./public/branding/**/*"] },
  serverExternalPackages: ["pdf-lib", "exceljs", "web-push"],
  // A private business app: tell search engines never to list any page, file or API route (covers the public candidate links too)
  async headers() { return [{ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }] }]; },
};
export default nextConfig;
