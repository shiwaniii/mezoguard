import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
  // Mezo Passport and its OrangeKit smart-account packages ship raw TypeScript sources.
  transpilePackages: ["@mezo-org/passport", "@mezo-org/orangekit", "@mezo-org/orangekit-smart-account", "@mezo-org/orangekit-contracts"],
  turbopack: {
    // @coinbase/cdp-sdk (via wagmi connectors) lazily imports x402 packages MezoGuard never uses.
    resolveAlias: {
      "@x402/core/client": "./lib/stubs/empty-module.js",
      "@x402/evm": "./lib/stubs/empty-module.js",
      "@x402/evm/exact/client": "./lib/stubs/empty-module.js",
      "@x402/evm/upto/client": "./lib/stubs/empty-module.js",
      "@x402/svm/exact/client": "./lib/stubs/empty-module.js",
    },
    rules: {
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
};

export default nextConfig;
