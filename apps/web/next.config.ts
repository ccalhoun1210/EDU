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
  // Baseline security headers. These live here (rather than in a repo-root
  // vercel.json) because the Vercel project's Root Directory is `apps/web`,
  // so a root-level vercel.json is never read. Defining them in next.config
  // guarantees they apply to every deployed response.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },
};

export default config;
