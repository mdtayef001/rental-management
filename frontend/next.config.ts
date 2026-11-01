import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Cache Components / partial prerendering are deliberately off.
  //
  // They exist to serve a static shell before the per-request data arrives. Every page in
  // this app sits behind a login and renders one business's own figures, so there is no
  // static shell to serve — turning it on only produced "uncached data during prerendering"
  // errors on every route. Speed here comes from server-side pagination and the TanStack
  // Query cache instead.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Don't advertise the framework to anyone probing the site.
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
          // The camera is needed for scanning; nothing else is.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
        ],
      },
    ]
  },
}

export default nextConfig
