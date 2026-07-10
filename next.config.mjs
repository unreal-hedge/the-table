import { fileURLToPath } from "url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Verification builds (npm run build:check) write elsewhere so they
  // never clobber the dev server's .next assets — running `next build`
  // beside `next dev` yanks CSS/JS out from under it (fresh loads 404
  // and render bare HTML). Vercel's real build keeps the default.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // poker-ts imports Node's "crypto" for its deck shuffle. Browsers
      // don't have it, so client bundles get a Web-Crypto-backed shim
      // (src/lib/crypto-browser-shim.ts). Server bundles keep real crypto.
      config.resolve.alias = {
        ...config.resolve.alias,
        crypto$: fileURLToPath(
          new URL("./src/lib/crypto-browser-shim.ts", import.meta.url)
        ),
      };
    }
    return config;
  },
};

export default nextConfig;
