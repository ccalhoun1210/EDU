import path from 'node:path';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ALLOWED_CALCULATORS, loadRulePack } from '@complianceos/rulepack-sdk';
import styles from './page.module.css';

// The deployed build must prove the rule pack it shipped with actually parses.
// Reading it at request time on the server keeps this honest after every deploy.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Rule library',
  description:
    'The federal IDEA Part B rule pack this build shipped with, parsed at request time — every rule with its regulatory citation.',
};

const PACK_DIR = path.join(process.cwd(), '../../rulepacks/federal/idea-b/us-fed-idea-b-2026');

export default async function RulePackPage() {
  const pack = await loadRulePack(PACK_DIR, ALLOWED_CALCULATORS);

  return (
    <main className={styles.doc}>
      <Link className={styles.back} href="/">
        ← ComplianceOS EDU
      </Link>

      <h1>Rule library</h1>
      <p className={styles.sub}>
        Loaded from the rule pack committed to this build, parsed on every request.
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
        Rules <span className={styles.tag}>{pack.rules.length}</span>
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
                <span className={styles.tag}>{rule.lifecycle}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Scope</h2>
      <p className={styles.note}>
        This page reads the committed rule pack and reports what parsed. No rule is evaluated yet —
        calculators are declared in the registry but not implemented, and no rule has passed legal
        review. See <code>docs/adrs</code> for the decisions behind this baseline.
      </p>
    </main>
  );
}
