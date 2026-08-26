/**
 * Static invariant tests over the SQL migrations.
 *
 * Spec: Master Technical Buildout sections 6, 7, 21 and 27. CLAUDE.md invariants 3, 4, 5,
 * 6, 7 and 8.
 *
 * These tests need no database. They parse every file under ../migrations and assert that
 * the schema still says what it is supposed to say. That matters because the isolation
 * suite in ./isolation.test.ts — the one that actually proves tenant A cannot read tenant
 * B's rows — needs a live Postgres and therefore does not run on a laptop. This file runs
 * everywhere, on every pull request, with nothing installed but the repository.
 *
 * What they are really defending is drift. Adding a table is easy; adding a table and
 * remembering FORCE ROW LEVEL SECURITY, a policy, a composite primary key, composite
 * foreign keys, NUMERIC money and DATE regulatory dates is five things to forget. Six
 * months from now somebody in a hurry will forget one, and the failure mode of most of
 * them is silent: the table works perfectly and is simply not isolated.
 *
 * The vocabulary cross-checks against @complianceos/domain exist for the same reason. A
 * CHECK constraint that has fallen behind its TypeScript union is a runtime insert failure
 * in production; here it is a red test.
 *
 * Note that this file deliberately imports nothing from ./client.js or ./migrate.js. Both
 * load the `pg` driver, and these assertions should hold on a checkout where no database
 * driver is present at all.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ASSESSMENT_RUN_KINDS,
  ASSESSMENT_RUN_STATUSES,
  ASSESSMENT_SCOPE_TYPES,
  AUDIT_ACTOR_TYPES,
  AUDIT_HASH_DOMAIN,
  CORRECTIVE_ACTION_STATES,
  DATA_CLASSIFICATIONS,
  EVALUATION_STATUSES,
  EVIDENCE_DOCUMENT_CLASSES,
  EVIDENCE_LINK_TARGET_KINDS,
  EVIDENCE_PERIOD_KINDS,
  EVIDENCE_SOURCES,
  FINDING_DISPOSITION_KINDS,
  FINDING_SUBJECT_TYPES,
  MALWARE_SCAN_STATUSES,
  ORGANIZATION_TYPES,
  REMEDIATION_SCOPES,
  RETENTION_CLASSES,
  SEVERITIES,
  TEXT_EXTRACTION_STATUSES,
  VERIFICATION_OUTCOMES,
} from '@complianceos/domain';

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../migrations');
const APP_ROLE = 'complianceos_app';

/* --------------------------------------------------------------------- parsing -- */

/**
 * Remove comments and dollar-quoted bodies, keeping ordinary string literals.
 *
 * Written as a scanner rather than a chain of regexes because both of the shortcuts here
 * are wrong: a `--` inside a string literal is not a comment, and a plpgsql body between
 * `$$` markers contains parentheses, semicolons and the word CHECK, none of which are part
 * of any table definition. Getting either wrong would make the parser quietly skip real
 * declarations, and a static test that silently checks nothing is worse than no test.
 */
function stripNoise(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const two = sql.slice(i, i + 2);
    if (two === '--') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end;
      out += ' ';
      continue;
    }
    if (two === '/*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      out += ' ';
      continue;
    }
    if (sql[i] === "'") {
      const end = sql.indexOf("'", i + 1);
      const stop = end === -1 ? sql.length : end + 1;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }
    const dollar = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
    if (dollar !== null) {
      const tag = dollar[0];
      const end = sql.indexOf(tag, i + tag.length);
      i = end === -1 ? sql.length : end + tag.length;
      out += ' NULL ';
      continue;
    }
    out += sql[i];
    i += 1;
  }
  return out;
}

/** Index of the `)` matching the `(` at `open`, skipping string literals. */
function matchingParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "'") {
      const end = text.indexOf("'", i + 1);
      i = end === -1 ? text.length : end;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Split a parenthesised table body on top-level commas. */
function splitTopLevel(body: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === "'") {
      const end = body.indexOf("'", i + 1);
      i = end === -1 ? body.length : end;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === ',' && depth === 0) {
      items.push(body.slice(start, i));
      start = i + 1;
    }
  }
  items.push(body.slice(start));
  return items.map((item) => item.trim()).filter((item) => item.length > 0);
}

interface Column {
  readonly name: string;
  readonly type: string;
  readonly raw: string;
}

interface ForeignKey {
  readonly columns: readonly string[];
  readonly refTable: string;
  readonly refColumns: readonly string[];
  readonly source: string;
}

interface Table {
  readonly name: string;
  readonly file: string;
  readonly columns: readonly Column[];
  readonly primaryKey: readonly string[] | undefined;
  readonly foreignKeys: readonly ForeignKey[];
  readonly raw: string;
}

const CONSTRAINT_START = /^(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|CONSTRAINT|EXCLUDE)\b/i;
const TYPE_AT_START =
  /^((?:timestamp\s+with(?:out)?\s+time\s+zone|double\s+precision|character\s+varying|[a-z_][a-z0-9_]*)(?:\s*\([^)]*\))?(?:\s*\[\s*\])?)/i;

function columnList(raw: string): string[] {
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function parseTables(sql: string, file: string): Table[] {
  const tables: Table[] = [];
  const header = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s*\(/gi;
  let match: RegExpExecArray | null;

  while ((match = header.exec(sql)) !== null) {
    const name = match[1];
    if (name === undefined) continue;
    const open = sql.indexOf('(', match.index + match[0].length - 1);
    const close = matchingParen(sql, open);
    expect(close, `${file}: unbalanced parentheses in CREATE TABLE ${name}`).toBeGreaterThan(open);
    const body = sql.slice(open + 1, close);

    const columns: Column[] = [];
    const foreignKeys: ForeignKey[] = [];
    let primaryKey: string[] | undefined;

    for (const item of splitTopLevel(body)) {
      if (CONSTRAINT_START.test(item)) {
        const pk = /^PRIMARY\s+KEY\s*\(([^)]*)\)/i.exec(item);
        if (pk?.[1] !== undefined) primaryKey = columnList(pk[1]);

        const fk =
          /^FOREIGN\s+KEY\s*\(([^)]*)\)\s*REFERENCES\s+([a-z_][a-z0-9_]*)\s*\(([^)]*)\)/i.exec(
            item,
          );
        if (fk?.[1] !== undefined && fk[2] !== undefined && fk[3] !== undefined) {
          foreignKeys.push({
            columns: columnList(fk[1]),
            refTable: fk[2],
            refColumns: columnList(fk[3]),
            source: `${name}: ${item.replace(/\s+/g, ' ').slice(0, 90)}`,
          });
        }
        continue;
      }

      const nameMatch = /^([a-z_][a-z0-9_]*)\s+/.exec(item);
      if (nameMatch?.[1] === undefined) continue;
      const columnName = nameMatch[1];
      const rest = item.slice(nameMatch[0].length);
      const typeMatch = TYPE_AT_START.exec(rest);
      const type = (typeMatch?.[1] ?? '').replace(/\s+/g, ' ').toLowerCase();
      columns.push({ name: columnName, type, raw: item });

      // A column-level REFERENCES is a single-column foreign key.
      const inline = /\bREFERENCES\s+([a-z_][a-z0-9_]*)\s*\(([^)]*)\)/i.exec(rest);
      if (inline?.[1] !== undefined && inline[2] !== undefined) {
        foreignKeys.push({
          columns: [columnName],
          refTable: inline[1],
          refColumns: columnList(inline[2]),
          source: `${name}.${columnName} REFERENCES ${inline[1]}`,
        });
      }
    }

    tables.push({
      name,
      file,
      columns,
      primaryKey,
      foreignKeys,
      raw: sql.slice(match.index, close + 1),
    });
  }

  return tables;
}

interface Grant {
  readonly privileges: readonly string[];
  readonly table: string;
  readonly grantee: string;
  readonly file: string;
}

interface Policy {
  readonly name: string;
  readonly table: string;
  readonly body: string;
  readonly file: string;
}

interface Trigger {
  readonly name: string;
  readonly table: string;
  readonly body: string;
  readonly file: string;
}

/* ------------------------------------------------------------------- the corpus -- */

const files = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith('.sql'))
  .sort();

const sources = files.map((file) => ({
  file,
  raw: readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'),
  sql: stripNoise(readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')),
}));

const tables: Table[] = sources.flatMap(({ file, sql }) => parseTables(sql, file));
const byName = new Map(tables.map((table) => [table.name, table]));

const alterForeignKeys: ForeignKey[] = [];
const rlsEnabled = new Set<string>();
const rlsForced = new Set<string>();
const policies: Policy[] = [];
const grants: Grant[] = [];
const triggers: Trigger[] = [];

for (const { file, sql } of sources) {
  for (const match of sql.matchAll(
    /ALTER\s+TABLE\s+([a-z_][a-z0-9_]*)\s+ADD\s+CONSTRAINT\s+[a-z_][a-z0-9_]*\s+FOREIGN\s+KEY\s*\(([^)]*)\)\s*REFERENCES\s+([a-z_][a-z0-9_]*)\s*\(([^)]*)\)/gi,
  )) {
    const [, table, columns, refTable, refColumns] = match;
    if (
      table === undefined ||
      columns === undefined ||
      refTable === undefined ||
      refColumns === undefined
    ) {
      continue;
    }
    alterForeignKeys.push({
      columns: columnList(columns),
      refTable,
      refColumns: columnList(refColumns),
      source: `${file}: ALTER TABLE ${table} ADD FOREIGN KEY`,
    });
  }

  for (const match of sql.matchAll(
    /ALTER\s+TABLE\s+([a-z_][a-z0-9_]*)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi,
  )) {
    if (match[1] !== undefined) rlsEnabled.add(match[1]);
  }
  for (const match of sql.matchAll(
    /ALTER\s+TABLE\s+([a-z_][a-z0-9_]*)\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/gi,
  )) {
    if (match[1] !== undefined) rlsForced.add(match[1]);
  }
  for (const match of sql.matchAll(
    /CREATE\s+POLICY\s+([a-z_][a-z0-9_]*)\s+ON\s+([a-z_][a-z0-9_]*)([\s\S]*?);/gi,
  )) {
    const [, name, table, body] = match;
    if (name === undefined || table === undefined) continue;
    policies.push({ name, table, body: body ?? '', file });
  }
  for (const match of sql.matchAll(
    /GRANT\s+([A-Za-z, ]+?)\s+ON\s+(?:TABLE\s+)?([a-z_][a-z0-9_]*)\s+TO\s+([a-z_][a-z0-9_]*)\s*;/gi,
  )) {
    const [, privileges, table, grantee] = match;
    if (privileges === undefined || table === undefined || grantee === undefined) continue;
    grants.push({
      privileges: privileges.split(',').map((p) => p.trim().toUpperCase()),
      table,
      grantee,
      file,
    });
  }
  for (const match of sql.matchAll(/CREATE\s+TRIGGER\s+([a-z_][a-z0-9_]*)([\s\S]*?);/gi)) {
    const [, name, body] = match;
    if (name === undefined || body === undefined) continue;
    const onTable = /\bON\s+([a-z_][a-z0-9_]*)/i.exec(body);
    triggers.push({ name, table: onTable?.[1] ?? '', body, file });
  }
}

/** A table is tenant-owned exactly when it carries a tenant_id column. */
function isTenantOwned(table: Table | undefined): boolean {
  return table !== undefined && table.columns.some((column) => column.name === 'tenant_id');
}

const tenantTables = tables.filter((table) => isTenantOwned(table));

function grantsFor(tableName: string): Grant[] {
  return grants.filter((grant) => grant.table === tableName && grant.grantee === APP_ROLE);
}

function privilegesFor(tableName: string): Set<string> {
  return new Set(grantsFor(tableName).flatMap((grant) => grant.privileges));
}

function column(tableName: string, columnName: string): Column {
  const table = byName.get(tableName);
  expect(table, `no CREATE TABLE ${tableName} in the migrations`).toBeDefined();
  const found = table?.columns.find((candidate) => candidate.name === columnName);
  expect(found, `${tableName} has no column ${columnName}`).toBeDefined();
  return found as Column;
}

/** The quoted literals of a column's `... IN (...)` CHECK, in declaration order. */
function checkedValues(tableName: string, columnName: string): string[] {
  const raw = column(tableName, columnName).raw;
  const inList = /\bIN\s*\(([^)]*)\)/i.exec(raw);
  expect(inList?.[1], `${tableName}.${columnName} has no CHECK ... IN (...) list`).toBeDefined();
  return [...(inList?.[1] ?? '').matchAll(/'([^']*)'/g)].flatMap((m) =>
    m[1] === undefined ? [] : [m[1]],
  );
}

/* ---------------------------------------------------------------------- the tests -- */

describe('the migration corpus', () => {
  it('is not empty and every file parses into tables', () => {
    expect(files.length).toBeGreaterThan(0);
    expect(tables.length).toBeGreaterThan(20);
  });

  it('numbers migrations consecutively from 0001 with no gap or duplicate', () => {
    const versions = files.map((file) => {
      const match = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(file);
      expect(match, `${file}: migrations are named NNNN_lower_snake_name.sql`).not.toBeNull();
      return match?.[1] ?? '';
    });
    expect(versions).toEqual(versions.map((_, index) => String(index + 1).padStart(4, '0')));
  });

  it('contains no destructive statement', () => {
    // Expand/contract (section 27): a migration adds. Removal is a separate, later
    // release, so a DROP appearing here means someone has coupled a destructive change to
    // a contract change.
    for (const { file, sql } of sources) {
      const destructive = sql.match(
        /\bDROP\s+(TABLE|COLUMN|SCHEMA|DATABASE|CONSTRAINT|POLICY|INDEX|ROLE|TYPE)\b/gi,
      );
      expect(destructive, `${file} contains a destructive statement`).toBeNull();
      expect(/\bRENAME\s+(TO|COLUMN)\b/i.test(sql), `${file} renames an object`).toBe(false);
    }
  });
});

describe('tenant isolation is declared in the schema (invariant 7, section 7)', () => {
  it('gives every tenant-owned table a composite primary key led by tenant_id', () => {
    for (const table of tenantTables) {
      expect(table.primaryKey, `${table.file}: ${table.name} has no PRIMARY KEY`).toBeDefined();
      expect(table.primaryKey, `${table.file}: ${table.name}`).toEqual(['tenant_id', 'id']);
    }
  });

  it('declares tenant_id as a NOT NULL uuid referencing tenants', () => {
    for (const table of tenantTables) {
      const tenantColumn = column(table.name, 'tenant_id');
      expect(tenantColumn.type, `${table.name}.tenant_id`).toBe('uuid');
      expect(/\bNOT\s+NULL\b/i.test(tenantColumn.raw), `${table.name}.tenant_id`).toBe(true);
      expect(/REFERENCES\s+tenants\s*\(\s*id\s*\)/i.test(tenantColumn.raw), table.name).toBe(true);
    }
  });

  it('forces row level security on every tenant-owned table', () => {
    for (const table of tenantTables) {
      expect(rlsEnabled.has(table.name), `${table.name} is missing ENABLE ROW LEVEL SECURITY`).toBe(
        true,
      );
      expect(rlsForced.has(table.name), `${table.name} is missing FORCE ROW LEVEL SECURITY`).toBe(
        true,
      );
    }
  });

  it('gives every tenant-owned table at least one policy, and every policy reads the GUC', () => {
    for (const table of tenantTables) {
      const forTable = policies.filter((policy) => policy.table === table.name);
      expect(forTable.length, `${table.name} has no RLS policy`).toBeGreaterThan(0);
      for (const policy of forTable) {
        expect(
          policy.body.includes('current_tenant_id()'),
          `policy ${policy.name} does not compare against current_tenant_id()`,
        ).toBe(true);
        expect(
          /tenant_id\s*=\s*current_tenant_id\(\)/.test(policy.body),
          `policy ${policy.name} does not filter on tenant_id`,
        ).toBe(true);
      }
    }
  });

  it('enables row level security on the tenant registry itself', () => {
    // `tenants` carries no tenant_id (it is the tenant dimension) so the rule above skips
    // it, but a tenant must still see only its own row.
    expect(rlsEnabled.has('tenants')).toBe(true);
    const forTable = policies.filter((policy) => policy.table === 'tenants');
    expect(forTable.length).toBeGreaterThan(0);
    for (const policy of forTable) {
      expect(policy.body.includes('current_tenant_id()')).toBe(true);
    }
  });

  it('carries tenant_id inside every foreign key between tenant-owned tables', () => {
    // This is the write-side defence: RLS hides another tenant's rows, and a composite
    // reference makes a row that points at one impossible to insert in the first place.
    const everyForeignKey = [
      ...tenantTables.flatMap((table) =>
        table.foreignKeys.map((fk) => ({ ...fk, from: table.name })),
      ),
      ...alterForeignKeys.map((fk) => ({ ...fk, from: fk.source })),
    ];

    for (const fk of everyForeignKey) {
      const target = byName.get(fk.refTable);
      if (!isTenantOwned(target)) continue;
      if (fk.refTable === 'tenants') continue;

      expect(fk.columns[0], `${fk.source}: first key column must be tenant_id`).toBe('tenant_id');
      expect(fk.refColumns[0], `${fk.source}: first referenced column must be tenant_id`).toBe(
        'tenant_id',
      );
      expect(fk.columns.length, `${fk.source}: composite key must have two columns`).toBe(2);
      expect(fk.refColumns.length, `${fk.source}: composite reference must have two columns`).toBe(
        2,
      );
    }
  });

  it('references the tenant registry only through the tenant_id column', () => {
    for (const table of tenantTables) {
      for (const fk of table.foreignKeys) {
        if (fk.refTable !== 'tenants') continue;
        expect(fk.columns, `${table.name}: only tenant_id may reference tenants`).toEqual([
          'tenant_id',
        ]);
      }
    }
  });

  it('never consults the organization hierarchy from a policy (invariant 8)', () => {
    // A parent organization does not inherit access to a child's data. The moment a policy
    // joins through organization_relationships, "the state agency can see all its
    // districts" becomes true by accident, for every tenant, retroactively.
    for (const policy of policies) {
      expect(
        policy.body.includes('organization_relationships'),
        `policy ${policy.name} reads the organization hierarchy`,
      ).toBe(false);
    }
  });
});

describe('privileges granted to the application role', () => {
  it('grants the app role something on every tenant-owned table', () => {
    for (const table of tenantTables) {
      expect(grantsFor(table.name).length, `${table.name} is unreachable by the app role`).toBe(1);
    }
  });

  it('never grants ALL PRIVILEGES, and never grants to PUBLIC', () => {
    for (const grant of grants) {
      expect(grant.privileges, `${grant.file}: GRANT ALL on ${grant.table}`).not.toContain('ALL');
      expect(grant.grantee, `${grant.file}: grant to ${grant.grantee}`).toBe(APP_ROLE);
    }
    for (const { file, sql } of sources) {
      expect(/\bTO\s+PUBLIC\b/i.test(sql), `${file} grants to PUBLIC`).toBe(false);
    }
  });

  it('keeps the append-only tables append-only', () => {
    // Section 21. Three layers: privileges here, triggers below, the hash chain in the
    // application. Any one alone is a story; together they are an audit trail.
    for (const table of ['audit_events', 'audit_seals', 'action_updates', 'attestations']) {
      const privileges = privilegesFor(table);
      expect([...privileges].sort(), `${table} privileges`).toEqual(['INSERT', 'SELECT']);
    }
  });

  it('never grants UPDATE on the raw zone or on a snapshot', () => {
    // A corrected value is a new import and a new snapshot, never a rewrite of what was
    // received (sections 10.3 and 11).
    for (const table of ['raw_records', 'data_snapshots', 'data_snapshot_facts']) {
      expect(privilegesFor(table).has('UPDATE'), `${table} is updatable`).toBe(false);
    }
  });

  it('grants nothing but SELECT on published regulatory content', () => {
    // Rule content is installed by the publish pipeline running as the owner. If the
    // application could write it, a tenant-facing bug could change what a rule means.
    for (const table of [
      'regulatory_sources',
      'requirements',
      'rule_packs',
      'rule_pack_versions',
      'rules',
      'rule_versions',
    ]) {
      expect([...privilegesFor(table)], `${table}`).toEqual(['SELECT']);
      expect(isTenantOwned(byName.get(table)), `${table} should be global content`).toBe(false);
    }
  });

  it('keeps the identity bindings global, readable, and not writable by the app', () => {
    // This table is the one deliberate exception to "a row that names a tenant is tenant
    // data", and it is asserted rather than merely permitted. A sign-in must read it before
    // tenant context exists, so it cannot be behind the GUC — which makes it worth pinning
    // that it is also the narrowest thing it can be.
    const table = 'identity_organization_bindings';
    const declared = byName.get(table);
    expect(declared, `${table} should be declared`).toBeDefined();

    // Not tenant-owned, by construction: the column is `bound_tenant_id`, because a row here
    // points at a district rather than belonging to one. If someone renames it to
    // `tenant_id`, the isolation guards above start applying and will fail — which is the
    // correct outcome, since a table called that must be isolated.
    expect(isTenantOwned(declared), `${table} names a tenant but does not belong to one`).toBe(
      false,
    );
    expect(
      declared?.columns.some((column) => column.name === 'bound_tenant_id'),
      `${table} should carry bound_tenant_id`,
    ).toBe(true);

    // Read only. Onboarding a district is an administrative act performed by the owner; if
    // the application could write this table, a bug in a tenant-facing path could rebind a
    // federated connection to a different district.
    expect([...privilegesFor(table)], table).toEqual(['SELECT']);
  });
});

describe('money and dates (invariants 5 and 6)', () => {
  const BANNED_TYPE = /\b(float|float4|float8|double precision|real|money)\b/;

  it('declares no approximate numeric column anywhere', () => {
    for (const table of tables) {
      for (const col of table.columns) {
        expect(
          BANNED_TYPE.test(col.type),
          `${table.file}: ${table.name}.${col.name} is ${col.type}; money is NUMERIC`,
        ).toBe(false);
      }
    }
  });

  it('types every amount column as NUMERIC with a scale', () => {
    for (const table of tables) {
      for (const col of table.columns) {
        if (!/_amount$/.test(col.name) && col.name !== 'amount') continue;
        expect(
          /^numeric\(\d+,\s*\d+\)$/.test(col.type),
          `${table.name}.${col.name} is ${col.type}; an amount is NUMERIC(p, s)`,
        ).toBe(true);
      }
    }
  });

  it('types every regulatory date as DATE', () => {
    // The naming convention is the invariant: `_on` is a calendar fact from the regulatory
    // world, `_at` is a system instant. A statutory deadline pushed through a UTC timestamp
    // can land on the previous day, and a deadline off by one is a wrong finding.
    for (const table of tables) {
      for (const col of table.columns) {
        if (!/_on$/.test(col.name) && !/_date$/.test(col.name)) continue;
        expect(col.type, `${table.name}.${col.name} names a calendar date`).toBe('date');
      }
    }
  });

  it('types every system timestamp as timestamptz', () => {
    for (const table of tables) {
      for (const col of table.columns) {
        if (!/_at$/.test(col.name)) continue;
        expect(col.type, `${table.name}.${col.name} names an instant`).toBe('timestamptz');
      }
    }
  });

  it('never uses a timestamp without a time zone', () => {
    for (const { file, sql } of sources) {
      expect(
        /\btimestamp\s+without\s+time\s+zone\b/i.test(sql),
        `${file} uses timestamp without time zone`,
      ).toBe(false);
      expect(
        /\btimestamp\b(?!\s*tz)(?!\s+with)/i.test(sql.replace(/timestamptz/gi, '')),
        `${file} uses a bare timestamp`,
      ).toBe(false);
    }
  });
});

describe('provenance and immutability (invariants 3 and 4)', () => {
  it('makes a finding uncreatable without its full provenance chain', () => {
    for (const name of [
      'assessment_run_id',
      'evaluation_result_id',
      'rule_id',
      'rule_version_id',
      'data_snapshot_id',
      'engine_version',
      'evaluation_hash',
    ]) {
      expect(
        /\bNOT\s+NULL\b/i.test(column('findings', name).raw),
        `findings.${name} must be NOT NULL`,
      ).toBe(true);
    }
  });

  it('binds every assessment run to a rule-pack version, an engine and a snapshot', () => {
    for (const name of ['rule_pack_version_id', 'engine_version', 'data_snapshot_id']) {
      expect(
        /\bNOT\s+NULL\b/i.test(column('assessment_runs', name).raw),
        `assessment_runs.${name} must be NOT NULL`,
      ).toBe(true);
    }
  });

  it('requires every canonical fact to name where it came from', () => {
    const provenance = byName.get('fact_provenance');
    expect(provenance).toBeDefined();
    expect(/\bNOT\s+NULL\b/i.test(column('fact_provenance', 'canonical_fact_id').raw)).toBe(true);
    expect(/\bNOT\s+NULL\b/i.test(column('fact_provenance', 'transformation').raw)).toBe(true);
    // A fact is either imported or derived. Never from nowhere.
    expect(
      /CHECK\s*\(\s*raw_record_id\s+IS\s+NOT\s+NULL\s+OR\s+derived_from_fact_id\s+IS\s+NOT\s+NULL\s*\)/i.test(
        provenance?.raw ?? '',
      ),
    ).toBe(true);
  });

  it('protects finalized runs and their results with triggers, not just with code', () => {
    const runTrigger = triggers.find((t) => t.table === 'assessment_runs');
    expect(runTrigger?.body).toMatch(/BEFORE\s+UPDATE\s+OR\s+DELETE/i);
    expect(runTrigger?.body).toMatch(/forbid_finalized_run_change/);

    // INSERT included: a finalized run must not be able to gain results either.
    for (const table of ['evaluation_results', 'findings']) {
      const trigger = triggers.find((t) => t.table === table);
      expect(trigger?.body, `${table} has no immutability trigger`).toMatch(
        /BEFORE\s+INSERT\s+OR\s+UPDATE\s+OR\s+DELETE/i,
      );
      expect(trigger?.body).toMatch(/forbid_finalized_run_result_change/);
    }
  });

  it('protects the audit log against update, delete and truncate', () => {
    const auditTriggers = triggers.filter((t) => t.table === 'audit_events');
    expect(auditTriggers.some((t) => /BEFORE\s+UPDATE\s+OR\s+DELETE/i.test(t.body))).toBe(true);
    expect(auditTriggers.some((t) => /BEFORE\s+TRUNCATE/i.test(t.body))).toBe(true);
  });

  it('chains audit events and refuses a fork', () => {
    const audit = byName.get('audit_events');
    expect(audit).toBeDefined();
    for (const name of ['previous_event_hash', 'event_hash', 'sequence_no']) {
      expect(/\bNOT\s+NULL\b/i.test(column('audit_events', name).raw), name).toBe(true);
    }
    // Two writers cannot both append event N, so history cannot branch.
    expect(/UNIQUE\s*\(\s*tenant_id,\s*sequence_no\s*\)/i.test(audit?.raw ?? '')).toBe(true);
  });

  it('freezes an ACTIVE rule version', () => {
    const trigger = triggers.find((t) => t.table === 'rule_versions');
    expect(trigger?.body).toMatch(/forbid_active_rule_version_change/);
  });

  it('will not build a report from a run that is not finalized (section 22)', () => {
    const trigger = triggers.find((t) => t.table === 'report_runs');
    expect(trigger?.body).toMatch(/require_finalized_run_for_report/);
    expect(trigger?.body).toMatch(/BEFORE\s+INSERT/i);
  });

  it('keeps a finding free of any mutable status column', () => {
    // A finding IS the engine's answer. Human judgement is additive rows in
    // finding_dispositions, so there is no column anyone could edit to make an
    // inconvenient finding go away.
    const findings = byName.get('findings');
    const names = (findings?.columns ?? []).map((col) => col.name);
    expect(names).not.toContain('status');
    expect(names).toContain('system_status');
    expect(privilegesFor('findings').has('UPDATE')).toBe(false);
  });
});

describe('the schema vocabulary matches @complianceos/domain', () => {
  // Each CHECK constraint below duplicates a union that TypeScript also declares. The
  // duplication is deliberate — the database must reject a bad value on its own — but a
  // duplicate that drifts is worse than no constraint, because it fails at INSERT time in
  // production rather than in review.
  const cases: ReadonlyArray<readonly [string, string, readonly string[]]> = [
    ['organizations', 'organization_type', ORGANIZATION_TYPES],
    ['evaluation_results', 'status', EVALUATION_STATUSES],
    ['evaluation_results', 'severity', SEVERITIES],
    ['evaluation_results', 'subject_type', FINDING_SUBJECT_TYPES],
    ['findings', 'severity', SEVERITIES],
    ['findings', 'subject_type', FINDING_SUBJECT_TYPES],
    ['finding_dispositions', 'kind', FINDING_DISPOSITION_KINDS],
    ['assessment_runs', 'status', ASSESSMENT_RUN_STATUSES],
    ['assessment_runs', 'kind', ASSESSMENT_RUN_KINDS],
    ['assessment_runs', 'scope_type', ASSESSMENT_SCOPE_TYPES],
    ['audit_events', 'actor_type', AUDIT_ACTOR_TYPES],
    ['canonical_facts', 'classification', DATA_CLASSIFICATIONS],
    ['evidence_items', 'classification', DATA_CLASSIFICATIONS],
    ['evidence_items', 'source', EVIDENCE_SOURCES],
    ['evidence_items', 'document_class', EVIDENCE_DOCUMENT_CLASSES],
    ['evidence_items', 'retention_class', RETENTION_CLASSES],
    ['evidence_items', 'malware_scan_status', MALWARE_SCAN_STATUSES],
    ['evidence_items', 'text_extraction_status', TEXT_EXTRACTION_STATUSES],
    ['evidence_items', 'period_kind', EVIDENCE_PERIOD_KINDS],
    ['corrective_actions', 'state', CORRECTIVE_ACTION_STATES],
    ['corrective_actions', 'remediation_scope', REMEDIATION_SCOPES],
    ['corrective_actions', 'verification_outcome', VERIFICATION_OUTCOMES],
  ];

  it.each(cases)('%s.%s', (table, columnName, expected) => {
    expect(checkedValues(table, columnName)).toEqual([...expected]);
  });

  it('restricts a finding to statuses that are actually findings', () => {
    // NOT_APPLICABLE and PASS are results, not findings; INDETERMINATE is a gap in the
    // data, which belongs on the run's coverage report rather than in a district's
    // finding list.
    const statuses = checkedValues('findings', 'system_status');
    expect(statuses.every((status) => (EVALUATION_STATUSES as readonly string[]).includes(status)));
    expect(statuses).toEqual(['FAIL', 'RISK', 'MANUAL_REVIEW']);
  });

  it('accepts only evidence link targets the schema can enforce', () => {
    const kinds = checkedValues('evidence_links', 'target_kind');
    for (const kind of kinds) {
      expect(EVIDENCE_LINK_TARGET_KINDS as readonly string[]).toContain(kind);
    }
    // CONTROL is the only domain target with no table yet. When `controls` arrives it needs
    // a column, a composite foreign key and this kind, together — which is what this
    // assertion is here to force.
    const missing = EVIDENCE_LINK_TARGET_KINDS.filter((kind) => !kinds.includes(kind));
    expect(missing).toEqual(['CONTROL']);
  });

  it('stamps audit events with the domain hash version', () => {
    expect(column('audit_events', 'hash_domain').raw).toContain(`'${AUDIT_HASH_DOMAIN}'`);
  });
});

describe('the IDEA fiscal tables hold no student identity (invariant 10)', () => {
  const FISCAL_TABLES = [
    'federal_awards',
    'idea_allocations',
    'fiscal_periods',
    'expenditure_facts',
    'budget_facts',
    'enrollment_counts',
    'special_ed_counts',
    'moe_adjustments',
    'moe_exceptions',
    'excess_cost_inputs',
    'proportionate_share_inputs',
    'ceis_cceis_inputs',
  ];

  it('declares every one of them', () => {
    for (const name of FISCAL_TABLES) {
      expect(byName.get(name), `${name} is missing`).toBeDefined();
    }
  });

  it('has no student identifier column', () => {
    // The IDEA_FISCAL module contract caps this module at CONFIDENTIAL. A column named for
    // a student would break that quietly, in a module that is supposed to be the proof the
    // platform can operate without student PII.
    const FORBIDDEN = /(^|_)(student_id|student_name|first_name|last_name|ssn|birth_date|dob)$/;
    for (const name of FISCAL_TABLES) {
      for (const col of byName.get(name)?.columns ?? []) {
        expect(
          FORBIDDEN.test(col.name),
          `${name}.${col.name} looks like a student identifier`,
        ).toBe(false);
      }
    }
  });

  it('cites the authority on every rule-bearing fiscal input', () => {
    for (const name of ['moe_adjustments', 'moe_exceptions', 'proportionate_share_inputs']) {
      const citation = column(name, 'citation');
      expect(/\bNOT\s+NULL\b/i.test(citation.raw), `${name}.citation`).toBe(true);
      expect(citation.raw).toMatch(/34 CFR 300\.\d+/);
    }
  });
});
