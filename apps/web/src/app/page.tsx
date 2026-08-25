import path from 'node:path';
import {
  ALLOWED_CALCULATORS,
  checkRuleSources,
  isVerified,
  loadRulePack,
  loadSourceRegistries,
  requiresVerifiedSource,
  type RegulatorySource,
  type Rule,
} from '@complianceos/rulepack-sdk';

// The deployed build must prove the rule pack it shipped with actually parses, and that the
// source-verification gate still holds against the content that shipped. Reading both at
// request time on the server keeps this honest after every deploy rather than at build time.
export const dynamic = 'force-dynamic';

const REPO_ROOT = path.join(process.cwd(), '../..');
const PACK_DIR = path.join(REPO_ROOT, 'rulepacks/federal/idea-b/us-fed-idea-b-2026');
const SOURCES_DIR = path.join(REPO_ROOT, 'rulepacks/sources');

function sourceState(rule: Rule, sources: readonly RegulatorySource[]): string {
  const source = sources.find((candidate) => candidate.sourceId === rule.authority.sourceId);
  if (source === undefined) return 'Unknown source';
  return isVerified(source) ? 'Retrieved and hashed' : 'Not retrieved';
}

export default async function Home() {
  const [pack, sources] = await Promise.all([
    loadRulePack(PACK_DIR, ALLOWED_CALCULATORS),
    loadSourceRegistries(SOURCES_DIR),
  ]);

  const problems = checkRuleSources(pack.rules, sources);
  const unverified = sources.filter((source) => !isVerified(source));
  const liveRules = pack.rules.filter((rule) => requiresVerifiedSource(rule.lifecycle));

  return (
    <>
      <h1>Rule library</h1>
      <p className="sub">
        The regulatory content this deployment shipped with, read from disk on each request.
      </p>

      <h2>Pack</h2>
      <dl className="definition-list">
        <dt>Identifier</dt>
        <dd>
          <code>{pack.manifest.packId}</code>
        </dd>
        <dt>Version</dt>
        <dd>{pack.manifest.version}</dd>
        <dt>Layer</dt>
        <dd>{pack.manifest.layer}</dd>
        <dt>Effective from</dt>
        <dd>{pack.manifest.effective.start}</dd>
        <dt>Rules</dt>
        <dd>{pack.rules.length}</dd>
      </dl>

      <h2>Rules</h2>
      <div className="table-wrap">
        <table>
          <caption>
            Every rule carries the provision it implements and the review stage it has reached.
          </caption>
          <thead>
            <tr>
              <th scope="col">Rule</th>
              <th scope="col">Authority</th>
              <th scope="col">Calculator</th>
              <th scope="col">Stage</th>
              <th scope="col">Source</th>
            </tr>
          </thead>
          <tbody>
            {pack.rules.map((rule) => (
              <tr key={rule.ruleId}>
                <td>
                  <code>{rule.ruleId}</code>
                </td>
                <td>
                  {rule.authority.url ? (
                    <a href={rule.authority.url} rel="noreferrer">
                      {rule.authority.citation}
                    </a>
                  ) : (
                    rule.authority.citation
                  )}
                </td>
                <td>
                  <code>{rule.calculator ?? '—'}</code>
                </td>
                <td>
                  <span className="tag">{rule.lifecycle}</span>
                </td>
                <td>{sourceState(rule, sources)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Source verification</h2>
      <div className="prose">
        <p>
          A rule may be authored and reviewed while its citation is unverified, but it cannot reach{' '}
          <code>STAGED</code>, <code>SHADOW</code> or <code>ACTIVE</code> — the stages at which it
          would evaluate a district&rsquo;s data — until the official text has been retrieved,
          hashed and archived. That gate runs in CI on every change.
        </p>
        <dl className="definition-list">
          <dt>Registered sources</dt>
          <dd>{sources.length}</dd>
          <dt>Awaiting retrieval</dt>
          <dd>{unverified.length}</dd>
          <dt>Rules evaluating data</dt>
          <dd>{liveRules.length}</dd>
          <dt>Gate</dt>
          <dd>{problems.length === 0 ? 'Holding' : `${problems.length} violation(s)`}</dd>
        </dl>
        <p className="note note-warn">
          No regulatory text has been retrieved in this environment, so every rule above is held at{' '}
          <code>DRAFT</code> and nothing here evaluates district data. Advancing the corpus means
          fetching each cited document, recording its hash, and obtaining the domain and legal
          review that section 35 requires. Retrieval and correctness are separate gates: a retrieval
          record proves the text was obtained, not that the rule implements it.
        </p>
      </div>
    </>
  );
}
