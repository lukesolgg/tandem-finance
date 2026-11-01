import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel builds its own output; "standalone" is for the Docker image.
  output: process.env.VERCEL ? undefined : "standalone",
  serverExternalPackages: ["pdfjs-dist", "@prisma/client", "pdfkit"],
  outputFileTracingIncludes: { "/api/statements": ["./node_modules/pdfjs-dist/legacy/build/*.mjs"] },
  experimental: { serverActions: { bodySizeLimit: "16mb" } },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
};
export default nextConfig;
