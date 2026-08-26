import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/marketing/site-header';
import { SiteFooter } from '@/components/marketing/site-footer';
import { LedgerSection } from '@/components/marketing/docket';
import { ArrowRightIcon, RiskGlyph } from '@/components/marketing/icons';
import styles from '@/app/sales.module.css';

export const metadata: Metadata = {
  title: 'IDEA Part B fiscal rules — ComplianceOS EDU',
  description:
    'The four fiscal requirements we evaluate — maintenance of effort, excess cost, proportionate share, and CEIS — each with its controlling citation and worked arithmetic.',
};

const REQUIREMENTS = [
  {
    id: 'moe',
    name: 'Maintenance of Effort (MOE)',
    cite: '34 CFR § 300.203',
    body: [
      'A district must spend at least as much on special education from local funds — or state and local funds combined — as it did in the most recent prior year it met the standard. There are four ways to satisfy it, and only one needs to pass.',
      'There are two distinct standards. The eligibility standard is tested prospectively, on the budget; the compliance standard is tested retrospectively, on actual expenditure. You can pass one and fail the other, which is why we evaluate both against the same snapshot.',
    ],
    worked: {
      label: 'Worked — compliance standard, state + local total',
      lines: [
        ['Required level (last year met)', '$4,844,754'],
        ['Current-year expenditure', '$4,823,114'],
        ['Difference', '-$21,640', true],
      ],
    },
  },
  {
    id: 'excess-cost',
    name: 'Excess cost',
    cite: '34 CFR § 300.16 / § 300.202',
    body: [
      'Part B funds may only pay for costs above the average annual per-pupil expenditure a district spends on all students. The minimum average is computed with a prescribed formula that excludes capital outlay, debt service, and certain federal program spending before dividing by enrollment.',
      'Getting the exclusions wrong is the common failure: include a capital line that should have been removed and the computed minimum is overstated, which understates the excess-cost room actually available.',
    ],
    worked: {
      label: 'Worked — minimum average per-pupil (elementary)',
      lines: [
        ['Total qualifying expenditure', '$58,200,000'],
        ['Enrollment (elementary)', '9,700'],
        ['Minimum average per pupil', '$6,000'],
      ],
    },
  },
  {
    id: 'proportionate-share',
    name: 'Proportionate share',
    cite: '34 CFR § 300.133',
    body: [
      'A district must spend a proportionate amount of its Part B subgrant on parentally-placed private-school children with disabilities, calculated from the ratio of those children to all eligible children in the district.',
      'The obligation is a spending floor, not a ceiling on services, and unspent proportionate-share funds carry their own reporting. We track the calculated obligation against actual spending across the year.',
    ],
    worked: {
      label: 'Worked — proportionate-share obligation',
      lines: [
        ['Part B subgrant (age 3–21)', '$1,600,000'],
        ['Private-school eligible ÷ all eligible', '48 ÷ 1,000'],
        ['Required proportionate share', '$76,800'],
      ],
    },
  },
  {
    id: 'ceis',
    name: 'CEIS / CCEIS and the 15% reservation',
    cite: '34 CFR § 300.226 / § 300.646',
    body: [
      'A district may reserve up to 15% of its Part B funds for coordinating early intervening services. If the state identifies the district as having significant disproportionality, a comparable reservation becomes mandatory (CCEIS).',
      'CEIS spending interacts with the 50% adjustment under § 300.205: money reserved for CEIS reduces the amount by which a district may lower its MOE requirement, so the two rules must be read together rather than in isolation.',
    ],
    worked: {
      label: 'Worked — maximum CEIS reservation',
      lines: [
        ['Part B subgrant', '$1,600,000'],
        ['Maximum reservation rate', '15%'],
        ['Maximum CEIS reservation', '$240,000'],
      ],
    },
  },
];

export default function IdeaFiscalPage() {
  return (
    <div className={styles.page}>
      <a className={styles.skipLink} href="#main">
        Skip to content
      </a>
      <SiteHeader active="/idea-fiscal" />

      <main id="main">
        <section className={styles.pageHero}>
          <div className={styles.container}>
            <p className={styles.pageKicker}>IDEA Part B fiscal</p>
            <h1 className={styles.pageTitle}>The four requirements, each with its citation and its arithmetic.</h1>
            <p className={styles.pageIntro}>
              This is the rule set we evaluate today. Every requirement below links to the
              controlling regulation and shows a worked calculation, because the content is the
              product demonstration.
            </p>
          </div>
        </section>

        {REQUIREMENTS.map((r, i) => (
          <LedgerSection
            key={r.id}
            first={i === 0}
            id={r.id}
            no={`§ 0${i + 1}`}
            tag={r.cite}
            title={r.name}
          >
            <div className={styles.reqGrid}>
              <div className={styles.prose}>
                {r.body.map((p) => (
                  <p key={p.slice(0, 24)}>{p}</p>
                ))}
              </div>
              <figure className={styles.workedBox}>
                <figcaption className={styles.workedLabel}>{r.worked.label}</figcaption>
                <div className={styles.workedRows}>
                  {r.worked.lines.map(([k, v, neg]) => (
                    <div className={styles.workedRow} key={String(k)}>
                      <span>{k}</span>
                      <span className={neg ? styles.workedNeg : undefined}>{v}</span>
                    </div>
                  ))}
                </div>
              </figure>
            </div>
          </LedgerSection>
        ))}

        {/* What a failure costs */}
        <LedgerSection
          id="liability"
          no="§ 05"
          tag="What failure costs"
          title="A bounded, statutory, local-dollar liability."
          lede="Under 34 CFR § 300.203(d), when an LEA fails to maintain effort, the state must repay the Department in non-federal funds — the shortfall, or the district’s Part B subgrant for that year, whichever is lower — and recovers it from the district."
        >
          <table className={styles.dataTable}>
            <thead>
              <tr>
                <th scope="col">Children served</th>
                <th scope="col">Part B grant ≈</th>
                <th scope="col">Maximum exposure</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">400</th>
                <td>$640,000</td>
                <td>$640,000</td>
              </tr>
              <tr>
                <th scope="row">1,000</th>
                <td>$1,600,000</td>
                <td>$1,600,000</td>
              </tr>
              <tr>
                <th scope="row">3,000</th>
                <td>$4,800,000</td>
                <td>$4,800,000</td>
              </tr>
            </tbody>
          </table>
          <div className={styles.prose} style={{ marginTop: '1.5rem' }}>
            <p>
              Two things follow. The exposure is capped at your annual subgrant — and it is paid in
              local dollars, from a budget already written, in a year when nothing was set aside for
              it.
            </p>
          </div>
        </LedgerSection>

        {/* The ten-day window */}
        <LedgerSection
          id="exceptions-window"
          no="§ 06"
          tag="The exceptions window"
          title="When the state asks, you have days — not weeks — to prove it."
          lede="In Texas, an LEA gets ten business days from the preliminary compliance review to submit its exceptions workbook, a superintendent-signed certification, and supporting documentation for every exception it claims. Other states run comparable windows."
        >
          <div className={styles.prose}>
            <p>
              The exceptions are real money: the voluntary departure of special-education personnel,
              a decrease in enrollment of children with disabilities, the end of an exceptionally
              costly program for a particular child, the end of a long-term purchase. Each can
              lawfully reduce what you were required to spend — <strong>if you can evidence it inside
              the window.</strong>
            </p>
            <p>
              Ten business days to reconstruct a year that closed months ago is how legitimate
              exceptions go unclaimed and districts repay money they did not owe. ComplianceOS EDU
              tracks exception-eligible events as they happen and keeps the supporting evidence
              linked to them. When the window opens, the packet is already built.
            </p>
          </div>
          <div className={`${styles.callout} ${styles.calloutRisk}`}>
            <span className={styles.calloutMark}>
              <RiskGlyph size={18} />
            </span>
            <p>
              State windows and workbooks differ. We model your state’s process specifically —{' '}
              <Link href="/resources">see the state MOE reference</Link>.
            </p>
          </div>
        </LedgerSection>

        {/* CTA */}
        <section id="contact" className={`${styles.section} ${styles.cta}`}>
          <div className={styles.container}>
            <div className={styles.ctaInner}>
              <div>
                <h2 className={styles.ctaTitle}>Inspect the rule packs yourself.</h2>
                <p className={styles.ctaSub}>
                  Every rule carries its citation, its authority, and the dates it was in force. Open
                  the registry, or bring your own numbers and we will run them.
                </p>
              </div>
              <div className={styles.ctaActions}>
                <Link className={`${styles.btn} ${styles.btnPrimary} ${styles.btnLg}`} href="/registry">
                  Open the rule registry
                  <ArrowRightIcon size={18} />
                </Link>
                <a
                  className={`${styles.btn} ${styles.btnGhost} ${styles.btnLg}`}
                  href="mailto:demo@complianceos.edu?subject=ComplianceOS%20EDU%20demo"
                >
                  Request a demo
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
