import type { Metadata } from 'next';
import { SiteHeader } from '@/components/marketing/site-header';
import { SiteFooter } from '@/components/marketing/site-footer';
import { LedgerSection } from '@/components/marketing/docket';
import { ArrowRightIcon, ShieldIcon } from '@/components/marketing/icons';
import styles from '@/app/sales.module.css';

export const metadata: Metadata = {
  title: 'For state agencies — ComplianceOS EDU',
  description:
    'Monitoring across every LEA in the state from the same versioned rule engine districts use — consistent determinations, reproducible runs, priced against state-level activity funds.',
};

const CAPABILITIES = [
  {
    title: 'One rule engine, every LEA',
    body: 'Run the same versioned, cited rule packs across every district in the state. Because determinations come from shared rules rather than a spreadsheet each district fills in differently, the results are comparable by construction.',
  },
  {
    title: 'Risk-based monitoring',
    body: 'Surface which LEAs are trending toward an MOE, excess-cost, or proportionate-share problem while the year is still open, so monitoring effort goes where the risk is instead of being spread evenly after the fact.',
  },
  {
    title: 'Reproducible determinations',
    body: 'Every LEA result is pinned to a data snapshot and a rule-pack version. When a district disputes a finding, you reproduce the exact run — same inputs, same rules, same answer — instead of re-litigating a spreadsheet.',
  },
  {
    title: 'Your state overlay, versioned',
    body: 'Federal baseline plus your administrative code, encoded as reviewable rule content with citations and effective dates. When your guidance changes, the overlay is versioned so prior determinations remain reproducible.',
  },
];

export default function ForStateAgenciesPage() {
  return (
    <div className={styles.page}>
      <a className={styles.skipLink} href="#main">
        Skip to content
      </a>
      <SiteHeader active="/for-state-agencies" />

      <main id="main">
        <section className={styles.pageHero}>
          <div className={styles.container}>
            <p className={styles.pageKicker}>For state agencies</p>
            <h1 className={styles.pageTitle}>Monitor every LEA from one engine — not a different spreadsheet each.</h1>
            <p className={styles.pageIntro}>
              A different product for a different buyer. State education agencies monitor IDEA fiscal
              compliance across every LEA; the same rule engine that gives a district its
              determination gives you consistent, reproducible determinations statewide.
            </p>
          </div>
        </section>

        <LedgerSection
          first
          id="capabilities"
          no="§ 01"
          tag="At the state level"
          title="The district product, turned toward oversight."
          lede="Districts use ComplianceOS EDU to know where they stand. State agencies use it to know where every LEA stands — from the same versioned rules, so a finding means the same thing in every county."
        >
          <div className={styles.notGrid}>
            {CAPABILITIES.map((c) => (
              <div className={styles.notCard} key={c.title}>
                <span className={styles.notIcon}>
                  <ShieldIcon size={20} />
                </span>
                <h3>{c.title}</h3>
                <p>{c.body}</p>
              </div>
            ))}
          </div>
        </LedgerSection>

        <LedgerSection
          id="funding"
          no="§ 02"
          tag="How it is funded"
          title="Priced against state-level activity, not a district budget."
          lede="This is not a per-district line item scaled up."
        >
          <div className={styles.prose}>
            <p>
              Under IDEA, a state may reserve a portion of its Part B funds for state-level
              activities, including monitoring, enforcement, and technical assistance to LEAs.
              Statewide compliance monitoring is squarely within that purpose.
            </p>
            <p>
              We scope and price a state engagement against that state-level activity, not against
              any single district’s budget. The exact treatment depends on your reserved funds and
              your priorities, so we work it through with your federal-programs and fiscal staff
              rather than asserting it.
            </p>
          </div>
          <div className={`${styles.callout} ${styles.calloutNavy}`}>
            <span className={styles.calloutMark}>
              <ShieldIcon size={18} />
            </span>
            <p>
              We do not claim a specific funding source applies to your state. We bring the analysis
              and the citations; your staff make the determination.
            </p>
          </div>
        </LedgerSection>

        <section id="contact" className={`${styles.section} ${styles.cta}`}>
          <div className={styles.container}>
            <div className={styles.ctaInner}>
              <div>
                <h2 className={styles.ctaTitle}>Talk to us about your state.</h2>
                <p className={styles.ctaSub}>
                  Bring your administrative code and a monitoring workflow. We will show how the
                  overlay is encoded and how a statewide run reproduces.
                </p>
              </div>
              <div className={styles.ctaActions}>
                <a
                  className={`${styles.btn} ${styles.btnPrimary} ${styles.btnLg}`}
                  href="mailto:states@complianceos.edu?subject=State%20agency%20monitoring"
                >
                  Start the conversation
                  <ArrowRightIcon size={18} />
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
