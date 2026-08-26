import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // Workspace packages are compiled by Next rather than pre-built, so a `vercel build`
  // needs no separate build step for the monorepo packages.
  transpilePackages: ['@complianceos/domain', '@complianceos/rulepack-sdk'],
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  // The workspace packages are authored as ESM TypeScript and import sibling
  // modules using explicit `.js` specifiers. Since Next transpiles the source
  // directly (no pre-built `dist`), teach webpack to resolve those `.js`
  // specifiers to the underlying `.ts` files.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default config;
