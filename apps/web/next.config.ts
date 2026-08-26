import type { NextConfig } from 'next';

/**
 * Security headers.
 *
 * These live here rather than in `vercel.json` because a repository-root `vercel.json` is only
 * read for a deployment whose Root Directory is the repository root, and this app deploys with
 * Root Directory `apps/web`. Headers declared there were never applied — a security control
 * that looked configured and was not. Declared in the framework, they apply wherever the app
 * runs, including `next start` and local development.
 *
 * Spec: Master Technical Buildout section 19.
 */
const SECURITY_HEADERS = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // No inline script is used, so the policy can be strict from the start. Loosening it later
  // is a deliberate act; starting loose and tightening never happens.
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
];

const config: NextConfig = {
  reactStrictMode: true,

  // Workspace packages are compiled by Next from source rather than pre-built, so a
  // `vercel build` needs no separate build step for them.
  transpilePackages: [
    '@complianceos/domain',
    '@complianceos/rulepack-sdk',
    '@complianceos/calculators',
    '@complianceos/rules-engine',
    '@complianceos/ingest',
  ],

  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,

  /**
   * The rule packs are read from disk at request time, and nothing imports them, so Next's
   * dependency tracing cannot see them. Without this they are absent from the deployed bundle
   * and every page that loads a pack fails at runtime — a build that succeeds and an
   * application that cannot start.
   */
  outputFileTracingIncludes: {
    '/': ['../../rulepacks/**/*.yaml'],
  },

  /**
   * The workspace packages are ESM TypeScript importing siblings with explicit `.js`
   * specifiers, which is what `verbatimModuleSyntax` and Node ESM require of the *emitted*
   * code. Next compiles the `.ts` source directly, so webpack has to be told that a `.js`
   * specifier means the `.ts` file next to it.
   */
  webpack: (webpackConfig: { resolve: { extensionAlias?: Record<string, readonly string[]> } }) => {
    webpackConfig.resolve.extensionAlias = {
      ...webpackConfig.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return webpackConfig;
  },

  async headers() {
    return [{ source: '/(.*)', headers: SECURITY_HEADERS }];
  },
};

export default config;
