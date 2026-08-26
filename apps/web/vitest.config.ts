import { defineConfig } from 'vitest/config';

/**
 * The web app's own unit tests.
 *
 * Only `.test.ts` — the pure modules behind the pages. Server components are async and read
 * the filesystem, so rendering them in a unit test would prove less than the route smoke test
 * (`scripts/smoke-web.mjs`) already does against a real build. What is worth testing here is
 * the wording and ordering logic the pages delegate to, because those are claims a district
 * could be misled by.
 */
export default defineConfig({
  test: { name: 'web', include: ['src/**/*.test.ts'] },
  resolve: {
    alias: {
      /**
       * `server-only` throws on import outside a React Server Component, which is the point
       * of it — a module holding the session sealer or the connection pool must never reach
       * the browser bundle. It also makes those modules untestable, and the one that decides
       * what this deployment IS has to be tested: getting it wrong 500s every application
       * route, which is exactly what happened once.
       *
       * Aliased to an empty module here rather than dropping the marker from the source,
       * because the marker is doing real work in the build.
       */
      'server-only': new URL('./src/test/server-only-stub.ts', import.meta.url).pathname,
    },
  },
});
