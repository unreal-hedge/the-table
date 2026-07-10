import { fileURLToPath } from "url";

/** @type {import('next').NextConfig} */
const nextConfig = {
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
