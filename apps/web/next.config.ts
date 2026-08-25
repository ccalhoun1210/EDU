import type { NextConfig } from 'next';

/**
 * Security headers.
 *
 * These live here rather than in `vercel.json` because the root `vercel.json` is only read
 * for a deployment whose Root Directory is the repository root. This app deploys with Root
 * Directory `apps/web`, so headers declared there were never applied — a security control
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

  // Workspace packages are compiled by Next rather than pre-built, so a `vercel build` needs
  // no separate build step for the monorepo packages.
  transpilePackages: ['@complianceos/domain', '@complianceos/rulepack-sdk'],

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

  async headers() {
    return [{ source: '/(.*)', headers: SECURITY_HEADERS }];
  },
};

export default config;
