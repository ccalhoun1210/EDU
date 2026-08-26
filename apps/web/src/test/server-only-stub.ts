/**
 * Stands in for the `server-only` package under Vitest.
 *
 * The real package throws when imported outside a React Server Component, which keeps the
 * session sealer and the connection pool out of the browser bundle and, as a side effect,
 * out of reach of a unit test. This empty module is aliased in `vitest.config.ts` so the
 * modules that carry the marker can still be tested; nothing about the production build
 * changes.
 */
export {};
