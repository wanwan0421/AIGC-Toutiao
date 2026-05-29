const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api";
const apiProxyTarget = (process.env.API_PROXY_TARGET ?? "http://localhost:3001").replace(/\/$/, "");
const apiOrigin = /^https?:\/\//i.test(apiBaseUrl) ? new URL(apiBaseUrl).origin : null;
const isDev = process.env.NODE_ENV !== "production";

const contentSecurityPolicy = [
  "default-src 'self'",
  `connect-src 'self'${apiOrigin ? ` ${apiOrigin}` : ""}`,
  "img-src 'self' data: blob: http: https:",
  "font-src 'self' data:",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  transpilePackages: ["@aicp/shared"],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiProxyTarget}/api/:path*`
      }
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }
        ]
      }
    ];
  }
};

export default nextConfig;
