/**
 * @complianceos/db — the schema, its migration runner, and the only sanctioned way to
 * reach the database.
 *
 * Spec: Master Technical Buildout sections 6, 7, 21 and 27.
 *
 * The SQL under ../migrations is the authoritative artifact of this package: tenant
 * isolation, provenance and immutability are enforced there, in the database, and not in
 * whatever service happens to be calling. What is exported here is the thin layer needed
 * to apply that schema and to open a connection with tenant context established.
 */

export * from './client.js';
export * from './import-store.js';
export * from './migrate.js';
export * from './run-store.js';
