import type { Metadata } from 'next';
import { SiteHeader } from '@/components/marketing/site-header';
import { SiteFooter } from '@/components/marketing/site-footer';
import { LedgerSection } from '@/components/marketing/docket';
import { ArrowRightIcon } from '@/components/marketing/icons';
import styles from '@/app/sales.module.css';

export const metadata: Metadata = {
  title: 'Resources — IDEA fiscal & state MOE reference — ComplianceOS EDU',
  description:
    'A plain-language reference for IDEA maintenance of effort: per-state MOE processes, the four methods, exceptions, and the subsequent-years rule — with citations and worked arithmetic.',
};

const STATES = [
  { name: 'Alabama', meta: 'Launch state', status: 'ready' },
  { name: 'Texas', meta: 'PEIMS · SHARS · SOF · 10-day window', status: 'ready' },
  { name: 'Wisconsin', meta: 'WISEdata Finance · published calendar', status: 'ready' },
  { name: 'New York', meta: 'Eligibility & compliance calculators', status: 'ready' },
  { name: 'Washington', meta: 'Guidance handbook', status: 'ready' },
  { name: 'More states', meta: 'Added as we can serve districts there', status: 'soon' },
];

const GUIDES = [
  { name: 'What happens if our district fails IDEA maintenance of effort?', meta: '§ 300.203(d)' },
  { name: 'The four MOE methods, explained with worked numbers', meta: '§ 300.203' },
  { name: 'MOE exceptions — what qualifies and what evidence you need', meta: '§ 300.204' },
  { name: 'Eligibility standard vs. compliance standard', meta: 'Two tests' },
  {
    name: 'The subsequent-years rule: why a failed year does not reset your baseline',
    meta: 'OSEP',
  },
  { name: 'Excess cost: the calculation, worked', meta: '§ 300.16' },
  {
    name: 'The 50% adjustment under § 300.205 — and why CEIS eats into it',
    meta: '§ 300.205 / § 300.226',
  },
];

const CALENDAR = [
  {
    when: 'Feb – Apr',
    doing: 'Building next year’s budget',
    publish: 'Eligibility standard; budgeting to pass MOE',
  },
  {
    when: 'Jun – Jul',
    doing: 'Fiscal close; certifications',
    publish: 'Closing the year cleanly; what to document now',
  },
  {
    when: 'Sep – Oct',
    doing: 'Claim amendments close; preliminary reviews',
    publish: 'The exceptions window; evidence checklists',
  },
  {
    when: 'Feb – Mar',
    doing: 'Final determinations and penalty notices',
    publish: 'What to do if you received one; corrective action',
  },
];

export default function ResourcesPage() {
  return (
    <div className={styles.page}>
      <a className={styles.skipLink} href="#main">
        Skip to content
      </a>
      <SiteHeader active="/resources" />

      <main id="main">
        <section className={styles.pageHero}>
          <div className={styles.container}>
            <p className={styles.pageKicker}>Resources</p>
            <h1 className={styles.pageTitle}>
              The IDEA fiscal reference your state agency writes badly.
            </h1>
            <p className={styles.pageIntro}>
              What each state’s MOE process actually is, which workbook it publishes, when its
              deadlines fall, and what its terminology means — with the authority linked and real
              arithmetic shown. The content is the product demonstration.
            </p>
          </div>
        </section>

        {/* State hub */}
        <LedgerSection
          first
          id="states"
          no="§ 01"
          tag="State MOE reference"
          title="One page per state, in launch order."
          lede="A director in Texas searches for PEIMS, SHARS, and SOF by name; a director one state over has never heard of them. We write each state’s process in its own vocabulary."
        >
          <div className={styles.indexList}>
            {STATES.map((s) => (
              <div
                className={styles.indexRow}
                key={s.name}
                aria-disabled={s.status === 'soon' ? 'true' : undefined}
              >
                <span className={styles.indexName}>{s.name}</span>
                <span className={styles.indexMeta}>
                  {s.status === 'soon' ? 'Coming soon' : s.meta}
                </span>
              </div>
            ))}
          </div>
        </LedgerSection>

        {/* Question-led guides */}
        <LedgerSection
          id="guides"
          no="§ 02"
          tag="Question-led guides"
          title="Answers to what a finance director actually types."
          lede="Each one links its authority and shows the arithmetic. No thought leadership — regulatory reference that happens to demonstrate the engine."
        >
          <div className={styles.indexList}>
            {GUIDES.map((g) => (
              <div className={styles.indexRow} key={g.name} aria-disabled="true">
                <span className={styles.indexName}>{g.name}</span>
                <span className={styles.indexMeta}>{g.meta}</span>
              </div>
            ))}
          </div>
        </LedgerSection>

        {/* Editorial calendar */}
        <LedgerSection
          id="calendar"
          no="§ 03"
          tag="The real cycle"
          title="Anchored to what districts are doing right now."
          lede="The compliance year has a shape. Our reference is published against it, so the guidance you need is live when the work is in front of you."
        >
          <table className={styles.dataTable}>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">What districts are doing</th>
                <th scope="col">Reference published</th>
              </tr>
            </thead>
            <tbody>
              {CALENDAR.map((c) => (
                <tr key={c.when}>
                  <th scope="row">{c.when}</th>
                  <td style={{ fontFamily: 'inherit', color: 'var(--ink)', fontWeight: 400 }}>
                    {c.doing}
                  </td>
                  <td style={{ fontFamily: 'inherit', color: 'var(--muted)', fontWeight: 400 }}>
                    {c.publish}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </LedgerSection>

        <section id="contact" className={`${styles.section} ${styles.cta}`}>
          <div className={styles.container}>
            <div className={styles.ctaInner}>
              <div>
                <h2 className={styles.ctaTitle}>Don’t see your state yet?</h2>
                <p className={styles.ctaSub}>
                  Tell us where you are. We prioritize the states where we can actually serve a
                  district next, and your request moves the queue.
                </p>
              </div>
              <div className={styles.ctaActions}>
                <a
                  className={`${styles.btn} ${styles.btnPrimary} ${styles.btnLg}`}
                  href="mailto:states@complianceos.edu?subject=State%20MOE%20reference%20request"
                >
                  Request your state
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
