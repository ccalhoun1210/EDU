import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // Workspace packages are compiled by Next rather than pre-built, so a `vercel build`
  // needs no separate build step for the monorepo packages.
  transpilePackages: ['@complianceos/domain', '@complianceos/rulepack-sdk'],
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  // The workspace packages are authored in TypeScript with NodeNext-style `.js`
  // import specifiers (e.g. `export * from './expression.js'`). Since Next compiles
  // their source directly, teach webpack to resolve those `.js` specifiers to the
  // actual `.ts` sources on disk.
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      ...webpackConfig.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return webpackConfig;
  },
};

export default config;
