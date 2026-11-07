import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    // bremo.io/flock (and artistsonly.io/flock): the Flock camera map, a static page in public/.
    // beforeFiles so the bremo.io root is served the map rather than the artistsonly.io landing page.
    return {
      beforeFiles: [{ source: "/", has: [{ type: "host", value: "(www\\.)?bremo\\.io" }], destination: "/flock.html" }],
      afterFiles: [{ source: "/flock", destination: "/flock.html" }],
      fallback: [],
    };
  },
  async headers() {
    return [
      {
        // The operations room is hidden: never indexed, never cached by intermediaries.
        source: "/akira/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "Cache-Control", value: "private, no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
      {
        source: "/api/akira/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
