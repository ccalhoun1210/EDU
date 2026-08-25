import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // Workspace packages are compiled by Next rather than pre-built, so a `vercel build`
  // needs no separate build step for the monorepo packages.
  transpilePackages: ['@complianceos/domain', '@complianceos/rulepack-sdk'],
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  // The workspace packages ship TypeScript source that uses ESM-style `.js`
  // extensions in relative imports (NodeNext convention). Map those specifiers
  // back to the real `.ts`/`.tsx` files so the bundler can resolve them.
  turbopack: {
    resolveExtensions: ['.ts', '.tsx', '.js', '.jsx', '.json', '.mjs'],
  },
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      ...webpackConfig.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    };
    return webpackConfig;
  },
};

export default config;
