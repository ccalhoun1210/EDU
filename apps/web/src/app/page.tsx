import path from 'node:path';
import { ALLOWED_CALCULATORS, loadRulePack } from '@complianceos/rulepack-sdk';
import { coverageForSection, findSection, loadInstrument } from '@complianceos/evidence';

// The deployed build must prove the rule pack it shipped with actually parses.
// Reading it at request time on the server keeps this honest after every deploy.
export const dynamic = 'force-dynamic';

const PACK_DIR = path.join(process.cwd(), '../../rulepacks/federal/idea-b/us-fed-idea-b-2026');
const INSTRUMENT_FILE = path.join(
  process.cwd(),
  '../../instruments/ga-gadoe-cfm/fy2025/instrument.yaml',
);
const SECTION = '18';

export default async function Home() {
  const pack = await loadRulePack(PACK_DIR, ALLOWED_CALCULATORS);
  const instrument = await loadInstrument(INSTRUMENT_FILE);
  const section = findSection(instrument, SECTION);
  if (section === undefined) throw new Error(`Instrument has no section ${SECTION}`);

  // No assertions exist yet — there is no persistence layer. The coverage below is
  // therefore the honest zero state, not a placeholder.
  const coverage = coverageForSection(section, []);

  return (
    <main>
      <h1>ComplianceOS EDU</h1>
      <p className="sub">Rule-pack registry — Phase 0 baseline.</p>

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

      <h2>
        {instrument.issuingAgency} — Section {section.sectionNumber}{' '}
        <span className="tag">{instrument.version}</span>
      </h2>
      <p className="sub">
        {section.title}. Monitored on a {instrument.monitoringCycleYears}-year cycle. Indicator
        numbering is the state’s own and is never renumbered by this system, so a director reads the
        same identifiers here that appear on their monitoring report.
      </p>
      <table>
        <thead>
          <tr>
            <th scope="col">Indicator</th>
            <th scope="col">Requirement</th>
            <th scope="col">Evidenced by</th>
            <th scope="col">Assertion</th>
          </tr>
        </thead>
        <tbody>
          {section.indicators.map((indicator) => (
            <tr key={indicator.indicatorId}>
              <td>
                <code>{indicator.indicatorId}</code>
              </td>
              <td>
                {indicator.title}
                {indicator.conditional ? <span className="tag">conditional</span> : null}
              </td>
              <td>
                {indicator.satisfiedByRules.length === 0 ? (
                  <span className="sub">narrative and documents</span>
                ) : (
                  indicator.satisfiedByRules.map((ruleId) => (
                    <div key={ruleId}>
                      <code>{ruleId}</code>
                    </div>
                  ))
                )}
              </td>
              <td>
                <span className="tag">
                  {coverage.entries.find((e) => e.indicatorId === indicator.indicatorId)?.status ??
                    'MISSING'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="sub">
        {coverage.attested} of {coverage.total} indicators attested. A binder for this section
        cannot be assembled until every indicator carries an attested assertion — there is no
        partial binder.
      </p>

      <h2>Scope</h2>
      <p className="sub">
        This page reads the committed rule pack and monitoring instrument and reports what parsed.
        No rule is evaluated yet — calculators are declared in the registry but not implemented, and
        no rule has passed legal review. There is no persistence layer, so no assertion, workpaper
        or evidence record can exist and every indicator above reads MISSING. See{' '}
        <code>docs/adrs</code> for the decisions behind this baseline, ADR 0006 in particular.
      </p>
    </main>
  );
}
