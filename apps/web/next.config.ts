import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // Workspace packages are compiled by Next rather than pre-built, so a `vercel build`
  // needs no separate build step for the monorepo packages.
  transpilePackages: ['@complianceos/domain', '@complianceos/rulepack-sdk'],
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
};

export default config;
