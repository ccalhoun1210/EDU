import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE, contactHref } from '@/site';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: {
    absolute: 'ComplianceOS EDU — audit-ready IDEA fiscal compliance',
  },
  description:
    'Know what a monitor would find before the monitor does. ComplianceOS EDU reads from the systems your district already runs, evaluates versioned IDEA Part B rules, and shows the evidence behind every result.',
  openGraph: {
    title: 'ComplianceOS EDU — audit-ready IDEA fiscal compliance',
    description:
      'A compliance assurance layer for publicly funded education programs. Deterministic rules, full provenance, immutable runs.',
    siteName: SITE.name,
    type: 'website',
  },
};

const BRIEFING = contactHref('Design-partner briefing — ComplianceOS EDU');
const MOE_REVIEW = contactHref('MOE review — ComplianceOS EDU');

const PROBLEMS = [
  {
    title: 'The answer lives in one workbook',
    body: 'Maintenance of effort is worked in a spreadsheet that one person maintains. The exceptions applied, the funds included, and the reason a line was excluded live in that person’s head — and they are the head that leaves.',
  },
  {
    title: 'The evidence lives everywhere else',
    body: 'Board minutes in a shared drive, invoices in the ERP, child counts in the SIS, consultation records in somebody’s sent mail. Assembling a monitoring packet is an archaeology project with a deadline attached.',
  },
  {
    title: 'Last year’s answer cannot be reproduced',
    body: 'The workbook has been edited since. The regulation has been amended since. When a reviewer asks what you concluded two years ago and why, there is no honest way to reconstruct it.',
  },
];

const STEPS = [
  {
    number: '01',
    title: 'Connect, read-only',
    body: 'Pull from the SIS, IEP platform, ERP, and HR system your district already runs, with a file drop for anything that has no API. Nothing is ever written back. Those systems stay authoritative.',
  },
  {
    number: '02',
    title: 'Normalize and snapshot',
    body: 'Incoming records are mapped into a canonical model, validated, and frozen into a dated snapshot. Every canonical value keeps a link to the source record and the transformation that produced it.',
  },
  {
    number: '03',
    title: 'Evaluate versioned rules',
    body: 'Rules are declarative content carrying a citation and an effective date, not code buried in a screen. Statutory arithmetic runs in allow-listed calculators. The same snapshot and pack always produce the same result.',
  },
  {
    number: '04',
    title: 'Explain, evidence, remediate',
    body: 'Every result names the rule, the values, and where each value came from, lists the evidence a reviewer will ask for, and carries a corrective action through to verified closure.',
  },
];

const MODULES = [
  {
    title: 'Fiscal assurance',
    body: 'The federal-funds math, shown in full rather than as a single verdict.',
    points: [
      'IDEA maintenance of effort — all four federal methods, eligibility and compliance',
      'Excess cost, elementary and secondary calculated separately',
      'Proportionate share and CEIS / CCEIS workspaces',
      'Scenario modeling on a cloned snapshot, never mixed with actuals',
    ],
  },
  {
    title: 'Programmatic assurance',
    body: 'The timelines a monitor counts in days, tracked as they run.',
    points: [
      'Child Find and initial evaluation timelines',
      'Annual IEP and reevaluation due dates',
      'Secondary transition documentation',
      'A risk queue ordered by what is closest to breaching',
    ],
  },
  {
    title: 'Monitoring readiness',
    body: 'Rehearse the review before the review letter arrives.',
    points: [
      'Mock monitoring protocols by requirement',
      'Evidence vault with hashing, holds, and reviewer disposition',
      'Corrective actions from draft through verified closure',
      'Report packages with methodology, citations, and attestation',
    ],
  },
  {
    title: 'Regulatory intelligence',
    body: 'The rules as versioned content, with the citation attached.',
    points: [
      'Federal baseline packs with state overlays',
      'Effective dates and superseded versions kept, never overwritten',
      'A source library behind every requirement',
      'Change review before a rule version goes active',
    ],
  },
];

const PROVENANCE = [
  'Finding',
  'Rule',
  'Rule version',
  'Regulatory authority',
  'Input fact',
  'Source record',
  'Transformation',
  'Data snapshot',
];

const ASSURANCES = [
  {
    title: 'Deterministic rules decide, not a model',
    body: 'Compliance outcomes come from versioned, reproducible logic. AI may classify a document, extract a candidate fact, or draft remediation language — always advisory, always labeled, always validated by a person before it becomes authoritative.',
  },
  {
    title: 'Finalized runs are immutable',
    body: 'New data or an amended regulation produces a new run. A prior result is never rewritten, so the question “what did this conclude on October 15, and on what basis?” has a real answer years later.',
  },
  {
    title: 'Missing data returns INDETERMINATE',
    body: 'When an input is absent, the result says so. The platform will not manufacture a pass to make a dashboard green, and it will not fail a district for a gap that is a data problem rather than a compliance problem.',
  },
  {
    title: 'The least student data that works',
    body: 'Each module declares its minimum data contract. IDEA fiscal operates with essentially no student PII, and identifiers stay separated from analytic records everywhere else.',
  },
];

const AUDIENCES = [
  {
    title: 'Business officials and CFOs',
    body: 'See every MOE method at once, model next year’s budget against the eligibility standard, and stop discovering a shortfall after the books close.',
  },
  {
    title: 'Special education directors',
    body: 'Watch timelines while they still have slack, and walk into a state review with the packet already assembled.',
  },
  {
    title: 'Federal programs directors',
    body: 'One place where excess cost, proportionate share, and CEIS reserves reconcile against the same snapshot of district data.',
  },
  {
    title: 'ESAs, co-ops, and state agencies',
    body: 'Roll up member districts without inheriting their data by default — access between organizations is always explicit.',
  },
];

const SHIPPED = [
  'Rule-pack schema, restricted rule DSL, and pack loader, validated in CI',
  'Federal IDEA Part B baseline pack — fiscal rules, each carrying its CFR citation',
  'Core domain model: evaluation statuses, organization hierarchy, explicit access scopes',
  'A live rule library that proves the shipped pack parses on every request',
];

const NEXT = [
  'Ingestion pipeline, canonical model, and dated data snapshots',
  'MOE, excess cost, and proportionate share calculators, golden tests written from the statute first',
  'Evidence vault, findings, and corrective-action workflow',
  'Pilot hardening: SSO, audit log, report packs, and the procurement package',
];

export default function LandingPage() {
  return (
    <div className={styles.page}>
      <header className={styles.masthead}>
        <div className={`${styles.shell} ${styles.mastheadInner}`}>
          <Link className={styles.wordmark} href="/">
            ComplianceOS <span className={styles.wordmarkBadge}>EDU</span>
          </Link>
          <nav className={styles.navLinks} aria-label="Sections">
            <a href="#how">How it works</a>
            <a href="#modules">Modules</a>
            <a href="#assurance">Why it holds up</a>
            <a href="#status">Status</a>
            <Link href="/rule-pack">Rule library</Link>
          </nav>
          <a className={`${styles.btnPrimary} ${styles.mastheadCta}`} href={BRIEFING}>
            {/* The full label does not fit beside the wordmark on a small handset. */}
            <span className={styles.ctaLabelFull}>Request a briefing</span>
            <span className={styles.ctaLabelShort}>Get a briefing</span>
          </a>
        </div>
      </header>

      <main>
        <section className={styles.shell} aria-labelledby="hero-title">
          <div className={styles.hero}>
            <div>
              <p className={styles.eyebrow}>IDEA Part B fiscal compliance</p>
              <h1 className={styles.heroTitle} id="hero-title">
                Know what a monitor would find, before the monitor does.
              </h1>
              <p className={styles.heroLede}>
                ComplianceOS EDU reads from the systems your district already runs, evaluates
                versioned federal and state rules, and shows{' '}
                <strong>the evidence behind every result</strong>.
              </p>
              <div className={styles.actions}>
                <a className={styles.btnPrimary} href={BRIEFING}>
                  Request a design-partner briefing
                </a>
                <Link className={styles.btnGhost} href="/rule-pack">
                  See the live rule library
                </Link>
              </div>
              <p className={styles.heroFine}>
                Read-only integrations. Your SIS, IEP platform, and ERP stay the systems of record.
              </p>
            </div>

            <div>
              <div className={styles.panel}>
                <div className={styles.panelHead}>
                  <span className={styles.panelTitle}>IDEA MOE — FY2028</span>
                  <span className={`${styles.pill} ${styles.muted}`}>ILLUSTRATIVE</span>
                </div>
                <div className={styles.panelRow}>
                  <span className={styles.panelLabel}>Local funds only</span>
                  <span className={styles.panelValue}>+$84,231</span>
                  <span className={`${styles.pill} ${styles.pass}`}>PASS</span>
                </div>
                <div className={styles.panelRow}>
                  <span className={styles.panelLabel}>State and local funds</span>
                  <span className={styles.panelValue}>+$146,002</span>
                  <span className={`${styles.pill} ${styles.pass}`}>PASS</span>
                </div>
                <div className={styles.panelRow}>
                  <span className={styles.panelLabel}>Local funds per capita</span>
                  <span className={styles.panelValue}>+$7.12</span>
                  <span className={`${styles.pill} ${styles.risk}`}>AT RISK</span>
                </div>
                <div className={styles.panelRow}>
                  <span className={styles.panelLabel}>State and local per capita</span>
                  <span className={styles.panelValue}>−$2.42</span>
                  <span className={`${styles.pill} ${styles.fail}`}>FAIL</span>
                </div>
                <div className={styles.panelFoot}>
                  <span>Qualifying methods: 2 of 4</span>
                  <span>Projected year-end: AT RISK</span>
                </div>
              </div>
              <p className={styles.panelCaption}>
                Illustrative output with synthetic figures. Every published result carries its rule
                version, its inputs, and the snapshot it was computed from.
              </p>
            </div>
          </div>
        </section>

        <section className={`${styles.section} ${styles.sectionSunken}`} aria-labelledby="problem">
          <div className={styles.shell}>
            <p className={styles.eyebrow}>The problem</p>
            <h2 className={styles.sectionTitle} id="problem">
              Districts rarely fail monitoring for being out of compliance. They fail for being
              unable to prove they were in it.
            </h2>
            <p className={styles.sectionLede}>
              The determination usually turns on whether a district can show its work — the
              calculation, the inputs, the exceptions applied, and the documents behind them — on
              the day a reviewer asks.
            </p>
            <div className={styles.grid3}>
              {PROBLEMS.map((item) => (
                <article className={styles.card} key={item.title}>
                  <h3 className={styles.cardTitle}>{item.title}</h3>
                  <p className={styles.cardBody}>{item.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.section} id="how" aria-labelledby="how-title">
          <div className={styles.shell}>
            <p className={styles.eyebrow}>How it works</p>
            <h2 className={styles.sectionTitle} id="how-title">
              A system of assurance, not another system of record.
            </h2>
            <p className={styles.sectionLede}>
              Nothing gets replaced and nothing gets migrated. ComplianceOS EDU sits alongside what
              you run and answers the question those systems were never built to answer.
            </p>
            <ol className={styles.steps}>
              {STEPS.map((step) => (
                <li className={styles.step} key={step.number}>
                  <span className={styles.stepNumber}>{step.number}</span>
                  <h3 className={styles.cardTitle}>{step.title}</h3>
                  <p className={styles.cardBody}>{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section
          className={`${styles.section} ${styles.sectionSunken}`}
          id="modules"
          aria-labelledby="modules-title"
        >
          <div className={styles.shell}>
            <p className={styles.eyebrow}>Modules</p>
            <h2 className={styles.sectionTitle} id="modules-title">
              Start with the fiscal math. Extend to everything a review touches.
            </h2>
            <p className={styles.sectionLede}>
              IDEA Part B fiscal compliance comes first because it is high-stakes, formula-driven,
              and can be done with almost no student PII. The same architecture carries the rest —
              Title I, Part C, Section 504, and subrecipient monitoring — without being rebuilt.
            </p>
            <div className={styles.grid4}>
              {MODULES.map((module) => (
                <article className={styles.card} key={module.title}>
                  <h3 className={styles.cardTitle}>{module.title}</h3>
                  <p className={styles.cardBody}>{module.body}</p>
                  <ul className={styles.cardList}>
                    {module.points.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.section} id="assurance" aria-labelledby="assurance-title">
          <div className={styles.shell}>
            <p className={styles.eyebrow}>Why it holds up</p>
            <h2 className={styles.sectionTitle} id="assurance-title">
              Built to survive the audit, not the demo.
            </h2>
            <p className={styles.sectionLede}>
              Every finding traces the full chain, and a finding that cannot trace it does not get
              created:
            </p>
            <ol className={styles.chain}>
              {PROVENANCE.map((node, index) => (
                <li className={styles.chainItem} key={node}>
                  {index > 0 ? <span className={styles.chainArrow}>→ </span> : null}
                  {node}
                </li>
              ))}
            </ol>
            <div className={styles.grid2}>
              {ASSURANCES.map((item) => (
                <article className={styles.card} key={item.title}>
                  <h3 className={styles.cardTitle}>{item.title}</h3>
                  <p className={styles.cardBody}>{item.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section
          className={`${styles.section} ${styles.sectionSunken}`}
          id="security"
          aria-labelledby="security-title"
        >
          <div className={styles.shell}>
            <p className={styles.eyebrow}>Security and procurement</p>
            <h2 className={styles.sectionTitle} id="security-title">
              Written for the person who reviews the data privacy agreement.
            </h2>
            <div className={styles.grid3}>
              <article className={styles.card}>
                <h3 className={styles.cardTitle}>Isolation you can point at</h3>
                <p className={styles.cardBody}>
                  Every tenant-owned record carries its tenant. Sensitive tables are protected by
                  database-level row security, and tenant context is set server-side from the
                  session — never taken from the browser. A parent organization does not inherit
                  access to a child’s data.
                </p>
              </article>
              <article className={styles.card}>
                <h3 className={styles.cardTitle}>Evidence handled as evidence</h3>
                <p className={styles.cardBody}>
                  Uploads are hashed, scanned, classified, and retained under a policy, with legal
                  and audit holds respected. A tamper-evident audit log records who saw what and
                  what changed.
                </p>
              </article>
              <article className={styles.card}>
                <h3 className={styles.cardTitle}>Honest claims only</h3>
                <p className={styles.cardBody}>
                  There is no such thing as “FERPA certified,” so we do not say it. We build the
                  technical and contractual controls that support your FERPA and state privacy
                  obligations, aligned with the SDPC National Data Privacy Agreement model.
                </p>
              </article>
            </div>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="who-title">
          <div className={styles.shell}>
            <p className={styles.eyebrow}>Who it is for</p>
            <h2 className={styles.sectionTitle} id="who-title">
              The people who get the letter.
            </h2>
            <div className={styles.grid4}>
              {AUDIENCES.map((item) => (
                <article className={styles.card} key={item.title}>
                  <h3 className={styles.cardTitle}>{item.title}</h3>
                  <p className={styles.cardBody}>{item.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section
          className={`${styles.section} ${styles.sectionSunken}`}
          id="status"
          aria-labelledby="status-title"
        >
          <div className={styles.shell}>
            <p className={styles.eyebrow}>Where the product is today</p>
            <h2 className={styles.sectionTitle} id="status-title">
              Early, and specific about it.
            </h2>
            <p className={styles.sectionLede}>
              ComplianceOS EDU is in pre-pilot development and is signing design partners, not
              customers. A platform whose entire premise is provable claims should be candid about
              its own. Here is exactly what runs today and what comes next.
            </p>
            <div className={styles.statusGrid}>
              <article className={styles.card}>
                <h3 className={styles.cardTitle}>Working today</h3>
                <ul className={styles.statusList}>
                  {SHIPPED.map((item) => (
                    <li key={item}>
                      <span className={styles.markShipped} aria-hidden="true">
                        ✓
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
              </article>
              <article className={styles.card}>
                <h3 className={styles.cardTitle}>Next, with design partners</h3>
                <ul className={styles.statusList}>
                  {NEXT.map((item) => (
                    <li key={item}>
                      <span className={styles.markPlanned} aria-hidden="true">
                        ◦
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
              </article>
            </div>
          </div>
        </section>

        <section className={styles.cta} aria-labelledby="cta-title">
          <div className={styles.shell}>
            <h2 className={styles.ctaTitle} id="cta-title">
              Bring us your hardest MOE year.
            </h2>
            <p className={styles.ctaLede}>
              Design partners help shape the calculators and the monitoring workflow against real
              district conditions, and get the fiscal module first. Tell us the year that was
              painful and we will walk through how it would be evaluated, cited, and evidenced.
            </p>
            <div className={`${styles.actions} ${styles.ctaActions}`}>
              <a className={styles.btnPrimary} href={BRIEFING}>
                Request a design-partner briefing
              </a>
              <a className={styles.btnGhost} href={MOE_REVIEW}>
                Ask about an MOE review
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.shell}>
          <div className={styles.footerTop}>
            <Link className={styles.wordmark} href="/">
              ComplianceOS <span className={styles.wordmarkBadge}>EDU</span>
            </Link>
            <nav className={styles.footerLinks} aria-label="Footer">
              <a href="#how">How it works</a>
              <a href="#modules">Modules</a>
              <a href="#security">Security</a>
              <a href="#status">Status</a>
              <Link href="/rule-pack">Rule library</Link>
              <a href={BRIEFING}>{SITE.contactEmail}</a>
            </nav>
          </div>
          <p className={styles.footerNote}>
            ComplianceOS EDU is a compliance assurance platform. It does not provide legal advice,
            and it does not replace your state education agency’s determinations. Final compliance
            decisions rest with the district and its authorizing agencies.
          </p>
        </div>
      </footer>
    </div>
  );
}
