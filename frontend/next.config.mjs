/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // No rewrites needed — all /api/* requests are handled by
  // src/app/api/[...path]/route.ts which proxies to BACKEND_URL at runtime.
};

export default nextConfig;
