/**
 * Install regulatory content into a database.
 *
 * Spec: Master Technical Buildout sections 8, 9 and 35. CLAUDE.md invariants 1, 3 and 4.
 *
 * A rule pack is content authored as YAML under /rulepacks. The engine can evaluate one
 * straight off disk, and every test does. A *stored* assessment cannot:
 * `assessment_runs.rule_pack_version_id` and `evaluation_results.rule_version_id` are NOT
 * NULL references into `rule_pack_versions` and `rule_versions`, so a finding can only be
 * written if the exact rule version it cites is already in the database.
 *
 * That is invariant 3 doing its job rather than an inconvenience. A finding is something a
 * district may be asked to defend to a monitor eighteen months later, and "the rule was in a
 * file on the machine that computed it" is not an answer. This script is what makes the
 * answer available: it reads the packs, hashes them, and writes them into the global content
 * tables the application role can only read.
 *
 * ## Owner, not the application role
 *
 * Regulatory content is global — it is not tenant-owned and it is not something a district
 * can change. The application role has SELECT on these tables and nothing else, so this runs
 * as the schema owner over the DIRECT connection, exactly like `db:migrate`.
 *
 * ## What it refuses
 *
 * - **A changed pack under an already-published version.** Invariant 4's principle applied
 *   to content: a version is a name for a specific set of rules. Re-publishing different
 *   rules under the same version would silently change what an existing finding cites. Bump
 *   the version instead. Republishing the *identical* content is a no-op, so the script is
 *   safe to run on every deploy.
 *
 * - **A lifecycle past QA_APPROVED whose regulatory source has not been retrieved.**
 *   Section 35, and `checkRuleSources` is the same check the rule-pack test suite runs. The
 *   federal sources currently carry `retrieval: null` — nobody has fetched and hashed the
 *   official text — so nothing may be published ACTIVE yet, and that is the point.
 *
 * ## Usage
 *
 *   DATABASE_URL_UNPOOLED=postgres://owner:...@host/db pnpm db:publish:rulepack
 *   ... pnpm db:publish:rulepack --schema complianceos
 *   ... pnpm db:publish:rulepack --pack rulepacks/federal/idea-b/us-fed-idea-b-2026
 *
 * The lifecycle each rule reaches is the one its YAML declares. There is no --status flag:
 * advancing a rule through review is a governance decision recorded in the content, not a
 * command-line argument.
 */

import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { argv, env, exit } from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function flag(name) {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  return value === undefined || value.startsWith('--') ? true : value;
}

const schema = typeof flag('schema') === 'string' ? flag('schema') : undefined;
const onlyPack = typeof flag('pack') === 'string' ? flag('pack') : undefined;

const connectionString = env['DATABASE_URL_UNPOOLED'] ?? env['DATABASE_URL'];
if (connectionString === undefined) {
  console.error(
    'No database URL. Set DATABASE_URL_UNPOOLED to the DIRECT connection string for the\n' +
      'schema owner. See .env.example.',
  );
  exit(1);
}

// The workspace packages export TypeScript source, so that Next compiles them directly and
// a change to a package is visible without a build step. A plain Node script cannot import
// that, and the compiled output imports its siblings by package name — which resolves back
// to the source. Each package therefore also declares a `dist` export condition, and this
// script runs with `--conditions=dist` (see `db:publish:rulepack` in package.json) so those
// sibling imports land on compiled output too. The condition is opt-in, so nothing else's
// resolution changes: Next and the tests still get the source.
let sdk;
let domain;
let engine;
try {
  sdk = await import('../packages/rulepack-sdk/dist/index.js');
  domain = await import('../packages/domain/dist/index.js');
  engine = await import('../packages/rules-engine/dist/index.js');
} catch (error) {
  console.error(
    'Could not load the rule-pack SDK from the compiled output.\n' +
      'Run `pnpm exec tsc --build` first, and invoke this through `pnpm db:publish:rulepack`\n' +
      `so that --conditions=dist is set.\n\n${String(error)}`,
  );
  exit(1);
}

const { loadRulePack, loadSourceRegistries, checkRuleSources, ALLOWED_CALCULATORS } = sdk;
const { hashCanonical } = domain;
const ENGINE_MIN_VERSION = engine.ENGINE_VERSION;

/** Every directory under rulepacks/ that has a pack.yaml, depth-first. */
async function findPacks(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const child = path.join(dir, entry.name);
    const names = await readdir(child);
    if (names.includes('pack.yaml')) found.push(child);
    else found.push(...(await findPacks(child)));
  }
  return found.sort();
}

/**
 * The hash a stored rule version is identified by.
 *
 * Over the rule's meaning, not its file: the same rule reformatted, or with its YAML keys
 * reordered, is the same rule and must hash the same, or every reformat would look like a
 * content change and refuse to republish. `hashCanonical` sorts object keys for exactly this.
 */
function ruleHash(rule) {
  return hashCanonical({
    ruleId: rule.ruleId,
    title: rule.title,
    pack: rule.pack,
    subjectType: rule.subjectType,
    lifecycle: rule.lifecycle,
    authority: rule.authority,
    effective: rule.effective,
    inputs: [...rule.inputs].sort(),
    calculator: rule.calculator ?? null,
    condition: rule.condition ?? null,
    applicability: rule.applicability ?? null,
    outputSchema: rule.outputSchema,
    severityOnFailure: rule.severityOnFailure,
    explanationTemplate: rule.explanationTemplate,
  });
}

const pg = (await import('pg')).default;
const client = new pg.Client({ connectionString });
await client.connect();

const written = { sources: 0, packs: 0, versions: 0, rules: 0, ruleVersions: 0 };
const skipped = [];

try {
  if (schema !== undefined) {
    if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error(`Not a valid schema name: ${schema}`);
    await client.query(`SET search_path TO "${schema}"`);
  }

  const sources = await loadSourceRegistries(path.join(ROOT, 'rulepacks', 'sources'));
  const packDirs = onlyPack
    ? [path.resolve(ROOT, onlyPack)]
    : await findPacks(path.join(ROOT, 'rulepacks'));

  const packs = [];
  for (const dir of packDirs) {
    packs.push({ dir, ...(await loadRulePack(dir, ALLOWED_CALCULATORS)) });
  }

  // Section 35, before anything is written: a rule may not reach STAGED or beyond while the
  // official text it cites has not been retrieved, hashed and archived.
  const problems = checkRuleSources(
    packs.flatMap((pack) => pack.rules),
    sources,
  );
  if (problems.length > 0) {
    console.error(
      'Refusing to publish. These rules cite regulatory sources that have not been verified:\n' +
        problems.map((problem) => `  ${problem.ruleId} ${problem.message}`).join('\n'),
    );
    exit(1);
  }

  await client.query('BEGIN');

  for (const source of sources) {
    // Sources are the authority library, keyed by a stable id. An UPDATE would let a
    // citation change under findings that already point at it, so an existing id is left
    // exactly as it is and a changed one is reported rather than applied.
    const existing = await client.query(
      'SELECT citation, official_url FROM regulatory_sources WHERE id = $1',
      [source.sourceId],
    );
    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      if (row.citation !== source.citation || row.official_url !== source.officialUrl) {
        skipped.push(
          `source ${source.sourceId} differs from the stored one (${row.citation}); ` +
            'supersede it with a new source id rather than editing it in place',
        );
      }
      continue;
    }

    await client.query(
      `INSERT INTO regulatory_sources
         (id, jurisdiction, publisher, title, citation, official_url, published_on,
          effective_start_on, effective_end_on, programs, retrieved_on, document_hash,
          archive_ref, retrieved_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        source.sourceId,
        source.jurisdiction,
        source.publisher,
        source.title,
        source.citation,
        source.officialUrl,
        source.publishedOn,
        source.effective.start,
        source.effective.end,
        source.programs,
        source.retrieval?.retrievedOn ?? null,
        source.retrieval?.documentHash ?? null,
        source.retrieval?.archiveRef ?? null,
        source.retrieval?.retrievedBy ?? null,
      ],
    );
    written.sources += 1;
  }

  for (const pack of packs) {
    const { manifest, rules } = pack;

    const packExists = await client.query('SELECT 1 FROM rule_packs WHERE id = $1', [
      manifest.packId,
    ]);
    if (packExists.rows.length === 0) {
      await client.query(
        `INSERT INTO rule_packs (id, jurisdiction, program, title, description, extends_pack_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          manifest.packId,
          manifest.jurisdiction,
          manifest.program,
          manifest.packId,
          manifest.description,
          manifest.extendsPack,
        ],
      );
      written.packs += 1;
    }

    // Over the manifest and every rule hash, so that adding, removing or editing any rule
    // changes the pack version's hash. That is what makes republishing a changed pack under
    // the same version detectable rather than a silent overwrite.
    const packHash = hashCanonical({
      manifest,
      rules: rules.map((rule) => ({ ruleId: rule.ruleId, hash: ruleHash(rule) })),
    });

    const priorVersion = await client.query(
      'SELECT id, content_hash, status FROM rule_pack_versions WHERE pack_id = $1 AND version = $2',
      [manifest.packId, manifest.version],
    );

    let packVersionId;
    if (priorVersion.rows.length > 0) {
      const row = priorVersion.rows[0];
      if (row.content_hash !== packHash) {
        throw new Error(
          `${manifest.packId}@${manifest.version} is already published with different content.\n` +
            'A version names a specific set of rules; republishing different rules under it\n' +
            'would change what existing findings cite. Bump the version in pack.yaml.',
        );
      }
      packVersionId = row.id;
      skipped.push(`${manifest.packId}@${manifest.version} is already published, unchanged`);
    } else {
      const inserted = await client.query(
        `INSERT INTO rule_pack_versions
           (pack_id, version, status, content_hash, engine_min_version, effective_start_on,
            effective_end_on, published_at)
         VALUES ($1, $2, 'DRAFT', $3, $4, $5, $6, now())
         RETURNING id`,
        [
          manifest.packId,
          manifest.version,
          packHash,
          // The engine that can evaluate this pack. Recorded so a future engine can refuse a
          // pack authored against a version whose semantics it no longer implements.
          ENGINE_MIN_VERSION,
          manifest.effective.start,
          manifest.effective.end,
        ],
      );
      packVersionId = inserted.rows[0].id;
      written.versions += 1;
    }

    for (const rule of rules) {
      const ruleExists = await client.query('SELECT 1 FROM rules WHERE id = $1', [rule.ruleId]);
      if (ruleExists.rows.length === 0) {
        await client.query(
          `INSERT INTO rules (id, pack_id, title, subject_type) VALUES ($1, $2, $3, $4)`,
          [rule.ruleId, rule.pack, rule.title, rule.subjectType],
        );
        written.rules += 1;
      }

      const already = await client.query(
        'SELECT content_hash FROM rule_versions WHERE rule_id = $1 AND rule_pack_version_id = $2',
        [rule.ruleId, packVersionId],
      );
      if (already.rows.length > 0) {
        if (already.rows[0].content_hash !== ruleHash(rule)) {
          throw new Error(
            `${rule.ruleId} is already published under ${manifest.packId}@${manifest.version} ` +
              'with different content. Bump the pack version.',
          );
        }
        continue;
      }

      // `version` is per rule id, so a rule republished in a later pack version gets the next
      // number rather than colliding on UNIQUE (rule_id, version).
      const next = await client.query(
        'SELECT coalesce(max(version), 0) + 1 AS version FROM rule_versions WHERE rule_id = $1',
        [rule.ruleId],
      );

      await client.query(
        `INSERT INTO rule_versions
           (rule_id, rule_pack_version_id, version, lifecycle, severity, authority_citation,
            source_id, logic, explanation_template, content_hash, effective_start_on,
            effective_end_on)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12)`,
        [
          rule.ruleId,
          packVersionId,
          next.rows[0].version,
          rule.lifecycle,
          rule.severityOnFailure,
          rule.authority.citation,
          rule.authority.sourceId,
          // The declarative rule, stored as data. There is no column that could hold
          // executable code and there must never be one (invariant 2).
          JSON.stringify({
            inputs: rule.inputs,
            calculator: rule.calculator ?? null,
            condition: rule.condition ?? null,
            applicability: rule.applicability ?? null,
            outputSchema: rule.outputSchema,
          }),
          rule.explanationTemplate,
          ruleHash(rule),
          rule.effective.start,
          rule.effective.end,
        ],
      );
      written.ruleVersions += 1;
    }
  }

  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  console.error(`Publish failed, nothing was written:\n${String(error)}`);
  await client.end();
  exit(1);
}

await client.end();

for (const note of skipped) console.log(`  note: ${note}`);
console.log(
  `Published ${String(written.ruleVersions)} rule version(s) across ` +
    `${String(written.versions)} pack version(s). ` +
    `New: ${String(written.sources)} source(s), ${String(written.packs)} pack(s), ` +
    `${String(written.rules)} rule(s).`,
);
