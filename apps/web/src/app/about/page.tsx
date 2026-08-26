import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/marketing/site-header';
import { SiteFooter } from '@/components/marketing/site-footer';
import { LedgerSection } from '@/components/marketing/docket';
import { ArrowRightIcon } from '@/components/marketing/icons';
import styles from '@/app/sales.module.css';

export const metadata: Metadata = {
  title: 'About — ComplianceOS EDU',
  description:
    'An independent software vendor building a compliance assurance layer for IDEA Part B fiscal rules. The honest version: judge the work, not a customer list.',
};

const PRINCIPLES = [
  {
    title: 'Every conclusion is reproducible',
    body: 'A determination that cannot be reproduced two years from now cannot be defended. Immutable snapshots and versioned rules exist so any past result reconstructs exactly.',
  },
  {
    title: 'Every rule is inspectable',
    body: 'Rules are content with citations, not opaque code. Your attorney can read the corpus and check that it says what the regulation says.',
  },
  {
    title: 'AI drafts; a person decides',
    body: 'AI reads documents and proposes language. It never makes a compliance determination. A human validates before anything becomes authoritative.',
  },
  {
    title: 'We state status honestly',
    body: 'INDETERMINATE when data is missing, “in progress” when a certification is not yet earned. The product exists to catch unbacked claims, so we do not make them ourselves.',
  },
];

const OBJECTIONS = [
  {
    q: '“We already have a spreadsheet from the state.”',
    a: 'So does every district — and it answers the question once, after the year has closed. We run the same tests continuously against the open year, and we keep the evidence for the exceptions window.',
  },
  {
    q: '“We can’t take on another system.”',
    a: 'You are not replacing anything. Read-only, no migration, no change to how staff work. Most districts start by sending the exports they already produce.',
  },
  {
    q: '“How do I know your numbers are right?”',
    a: 'Every number shows its arithmetic, its inputs, the rows they came from, and the regulation it applies. Check any of them — that is the product.',
  },
  {
    q: '“Is this AI deciding our compliance?”',
    a: 'No. Rules are deterministic and versioned. AI reads documents and drafts language; a person validates before anything counts.',
  },
  {
    q: '“We’re a small district.”',
    a: 'Direct pricing starts above roughly 250 children served. Below that, talk to your ESA — the economics work through them.',
  },
  {
    q: '“You’re a new company.”',
    a: 'Stated plainly. What we offer instead of a customer list: an architecture built so every conclusion is reproducible and inspectable, and a rule corpus with its citations visible. Judge the work.',
  },
  {
    q: '“Can we pay for this with IDEA funds?”',
    a: 'The honest answer: it depends on how your district and SEA treat administrative costs, and we will work it through with your federal-programs director. We do not assert it.',
  },
];

export default function AboutPage() {
  return (
    <div className={styles.page}>
      <a className={styles.skipLink} href="#main">
        Skip to content
      </a>
      <SiteHeader active="/about" />

      <main id="main">
        <section className={styles.pageHero}>
          <div className={styles.container}>
            <p className={styles.pageKicker}>About</p>
            <h1 className={styles.pageTitle}>Judge the work, not a customer list.</h1>
            <p className={styles.pageIntro}>
              ComplianceOS EDU is an independent software vendor building a compliance assurance
              layer for publicly funded education programs. We are new, we say so, and we designed
              the product so you can verify every claim it makes.
            </p>
          </div>
        </section>

        <LedgerSection
          first
          id="what-we-are"
          no="§ 01"
          tag="What we are"
          title="A compliance assurance layer — not another system of record."
        >
          <div className={styles.prose}>
            <p>
              We do not replace your student information system, your IEP platform, or your ERP. We
              read from them, apply the federal and state rules that govern your special-education
              spending, and tell you what a monitor would find — while the year is still open.
            </p>
            <p>
              The company exists because the question &ldquo;if we were monitored today, what would
              they find?&rdquo; gets answered once a year, by hand, in a spreadsheet the state
              publishes — and the answer arrives after the fiscal year has closed. We answer it
              continuously, from the same data, with every conclusion traced to its authority.
            </p>
          </div>
        </LedgerSection>

        <LedgerSection
          id="principles"
          no="§ 02"
          tag="How we build"
          title="Four commitments, encoded in the product."
          lede="These are not values on a wall; they are properties you can test in a demo."
        >
          <div className={styles.notGrid}>
            {PRINCIPLES.map((p) => (
              <div className={styles.notCard} key={p.title}>
                <h3>{p.title}</h3>
                <p>{p.body}</p>
              </div>
            ))}
          </div>
        </LedgerSection>

        <LedgerSection
          id="objections"
          no="§ 03"
          tag="Straight answers"
          title="The questions districts actually ask."
          lede="Written down here rather than saved for a call."
        >
          <div className={styles.qa}>
            {OBJECTIONS.map((o) => (
              <div className={styles.qaRow} key={o.q}>
                <p className={styles.qaQ}>{o.q}</p>
                <p className={styles.qaA}>{o.a}</p>
              </div>
            ))}
          </div>
        </LedgerSection>

        <section id="contact" className={`${styles.section} ${styles.cta}`}>
          <div className={styles.container}>
            <div className={styles.ctaInner}>
              <div>
                <h2 className={styles.ctaTitle}>Come test the claims.</h2>
                <p className={styles.ctaSub}>
                  Bring a program you oversee. We will produce a determination you could hand to a
                  monitor and let you check every number in it.
                </p>
              </div>
              <div className={styles.ctaActions}>
                <a
                  className={`${styles.btn} ${styles.btnPrimary} ${styles.btnLg}`}
                  href="mailto:demo@complianceos.edu?subject=ComplianceOS%20EDU%20demo"
                >
                  Request a demo
                  <ArrowRightIcon size={18} />
                </a>
                <Link className={`${styles.btn} ${styles.btnGhost} ${styles.btnLg}`} href="/how-it-works">
                  See how it works
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
