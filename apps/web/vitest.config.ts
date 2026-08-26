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
export default defineConfig({ test: { name: 'web', include: ['src/**/*.test.ts'] } });
