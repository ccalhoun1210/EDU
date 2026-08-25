import path from 'node:path';
import Link from 'next/link';
import { ALLOWED_CALCULATORS, loadRulePack } from '@complianceos/rulepack-sdk';

// The deployed build must prove the rule pack it shipped with actually parses.
// Reading it at request time on the server keeps this honest after every deploy.
export const dynamic = 'force-dynamic';

const PACK_DIR = path.join(process.cwd(), '../../rulepacks/federal/idea-b/us-fed-idea-b-2026');

export default async function Registry() {
  const pack = await loadRulePack(PACK_DIR, ALLOWED_CALCULATORS);

  return (
    <main>
      <p className="sub">
        <Link href="/">← Back to ComplianceOS EDU</Link>
      </p>
      <h1>Live rule-pack registry</h1>
      <p className="sub">
        This page reads the committed rule pack on the server at request time — proof the deployed
        build ships a pack that actually parses.
      </p>

      <h2>Loaded pack</h2>
      <table>
        <tbody>
          <tr>
            <th scope="row">Pack</th>
            <td>
              <code>{pack.manifest.packId}</code>
            </td>
          </tr>
          <tr>
            <th scope="row">Version</th>
            <td>{pack.manifest.version}</td>
          </tr>
          <tr>
            <th scope="row">Layer</th>
            <td>{pack.manifest.layer}</td>
          </tr>
          <tr>
            <th scope="row">Effective from</th>
            <td>{pack.manifest.effective.start}</td>
          </tr>
        </tbody>
      </table>

      <h2>
        Rules <span className="tag">{pack.rules.length}</span>
      </h2>
      <table>
        <thead>
          <tr>
            <th scope="col">Rule</th>
            <th scope="col">Authority</th>
            <th scope="col">Calculator</th>
            <th scope="col">Stage</th>
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
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Scope</h2>
      <p className="sub">
        This page reads the committed rule pack and reports what parsed. No rule is evaluated yet —
        calculators are declared in the registry but not implemented, and no rule has passed legal
        review. See <code>docs/adrs</code> for the decisions behind this baseline.
      </p>
    </main>
  );
}
