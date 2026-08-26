import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/marketing/site-header';
import { SiteFooter } from '@/components/marketing/site-footer';
import { LedgerSection } from '@/components/marketing/docket';
import { WhyPanel } from '@/components/marketing/why-panel';
import { ArrowRightIcon, PassGlyph, FailGlyph, RiskGlyph } from '@/components/marketing/icons';
import styles from '@/app/sales.module.css';

export const metadata: Metadata = {
  title: 'How it works — ComplianceOS EDU',
  description:
    'Six steps from your existing exports to a defensible determination: connect, normalize, snapshot, evaluate versioned rules, explain every result, and attach evidence.',
};

const STEPS = [
  {
    title: 'Connect what you already have',
    body: 'Read-only exports or connections from your ERP, SIS, and IEP platform. No migration, no write-back, no change to how your staff work. If your data comes out as a spreadsheet, that is a supported input — most districts start there.',
  },
  {
    title: 'Normalize into one picture',
    body: 'Expenditure lines, fund codes, enrollment, child count, and program data from different systems get mapped into a single model. The mapping is explicit and reviewable — you see which fund codes we treated as local, which as state, and which we excluded as federal. Get that wrong and every downstream number is wrong, so we show it rather than assume it.',
  },
  {
    title: 'Freeze a snapshot',
    body: 'Every assessment runs against an immutable snapshot of your data at a moment in time, with a snapshot ID. That is what makes a result reproducible: when someone asks in 2029 what the system concluded in October 2027, we reconstruct it exactly — same data, same rule versions, same answer.',
  },
  {
    title: 'Evaluate versioned rules',
    body: 'Federal baseline rules, your state overlay, and any local policy layered on top. Each rule carries its citation, its authority, and the dates it was in force, so a run selects the rules that actually applied on its as-of date. Rules are content, not code — reviewable by your attorney without reading software.',
  },
  {
    title: 'Explain every result',
    body: 'No status appears without its reasoning: the requirement, the regulation, the arithmetic, and the rows it came from. See the determination on the right — that is what every conclusion looks like.',
  },
  {
    title: 'Attach evidence and manage what follows',
    body: 'Findings link to the documents that support or resolve them, and corrective actions track through to closure. When the state asks, the packet is already assembled.',
  },
];

const METHODS = [
  { method: 'Local funds, total', comparison: '$4,200,000', current: '$4,150,000', margin: 'Short $50,000', pass: false },
  { method: 'Local funds, per child', comparison: '$10,194.17', current: '$10,375.00', margin: 'Passes by $180.83', pass: true },
  { method: 'State + local, total', comparison: '$6,800,000', current: '$6,900,000', margin: 'Passes by $100,000', pass: true },
  { method: 'State + local, per child', comparison: '$16,504.85', current: '$17,250.00', margin: 'Passes by $745.15', pass: true },
];

export default function HowItWorksPage() {
  return (
    <div className={styles.page}>
      <a className={styles.skipLink} href="#main">
        Skip to content
      </a>
      <SiteHeader active="/how-it-works" />

      <main id="main">
        <section className={styles.pageHero}>
          <div className={styles.container}>
            <p className={styles.pageKicker}>How it works</p>
            <h1 className={styles.pageTitle}>From the exports you already produce to a number you can defend.</h1>
            <p className={styles.pageIntro}>
              This is the work, in your language. Six steps, no migration, and a determination at
              the end that shows every input, the regulation it applies, and the rows it came from.
            </p>
          </div>
        </section>

        {/* Six steps */}
        <LedgerSection
          first
          id="steps"
          no="§ 01"
          tag="The pipeline"
          title="Six steps, and none of them replace a system you rely on."
          lede="Your district already produces every number IDEA fiscal compliance depends on. What does not exist is anything that holds them together and answers the only question that matters: if we were monitored today, what would they find?"
        >
          <div className={styles.steps}>
            {STEPS.map((s, i) => (
              <div className={styles.step} key={s.title}>
                <span className={styles.stepNo}>{String(i + 1).padStart(2, '0')}</span>
                <div className={styles.stepBody}>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </div>
              </div>
            ))}
          </div>
        </LedgerSection>

        {/* The Why panel */}
        <LedgerSection
          id="why"
          no="§ 02"
          tag="Explain every result"
          title="Every conclusion looks like this. No black box, no score."
          lede="No “compliance health” percentage, no letter grade. The requirement, the regulation, the arithmetic, and the source rows — the same thing a hearing officer would ask you to produce."
        >
          <WhyPanel />
        </LedgerSection>

        {/* Four methods */}
        <LedgerSection
          id="methods"
          no="§ 03"
          tag="The four-method test"
          title="IDEA gives your district four ways to satisfy MOE. You only need one."
          lede="Local funds only, state and local combined, and each of those per child. Most tools — and most state spreadsheets — check the one that seems obvious. If your child count fell, the total-basis methods come under pressure while the per-child methods may pass comfortably. Check only the first and you report a failure that is not a failure."
        >
          <div className={styles.methodsWrap}>
            <table className={styles.methodsTable}>
              <thead>
                <tr>
                  <th scope="col">Method</th>
                  <th scope="col">Comparison year</th>
                  <th scope="col">Current year</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {METHODS.map((m) => (
                  <tr key={m.method}>
                    <th scope="row">{m.method}</th>
                    <td className={styles.methodsNum}>{m.comparison}</td>
                    <td className={styles.methodsNum}>{m.current}</td>
                    <td>
                      <span className={`${styles.methodResult} ${m.pass ? styles.methodPass : styles.methodShort}`}>
                        {m.pass ? <PassGlyph size={13} /> : <FailGlyph size={13} />}
                        {m.margin}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.methodsVerdict}>
            <span className={styles.methodsVerdictMark}>
              <PassGlyph size={16} />
            </span>
            <span>
              <strong>Three of four methods qualify. This district is compliant.</strong> A
              single-method check would have reported a $50,000 failure and started a repayment
              conversation over money that was never owed.
            </span>
          </p>
        </LedgerSection>

        {/* Subsequent-years rule */}
        <LedgerSection
          id="subsequent-years"
          no="§ 04"
          tag="The credibility section"
          title="A year you failed does not lower next year’s bar."
          lede="This is the rule districts most often get wrong on their own — and getting it wrong quietly compounds the problem."
        >
          <div className={styles.prose}>
            <p>
              If your district missed MOE, the level required the following year is the level that{' '}
              <strong>would</strong> have been required had you not missed it — not the reduced
              amount you actually spent. As OSEP puts it, the required level is the one from the last
              year the LEA met MOE.
            </p>
            <p>
              Districts that rebuild next year’s budget from what they really spent dig the hole
              deeper without knowing it. ComplianceOS EDU carries the required level forward as a
              tracked fact, so your baseline is right even after a bad year.
            </p>
          </div>
          <div className={`${styles.callout} ${styles.calloutNavy}`}>
            <span className={styles.calloutMark}>
              <RiskGlyph size={18} />
            </span>
            <p>
              Verified across the 2015 IDEA final rule, Wisconsin DPI quoting OSEP, and the Texas
              Education Agency. This is a published rule, not our interpretation.
            </p>
          </div>
        </LedgerSection>

        {/* CTA */}
        <section id="contact" className={`${styles.section} ${styles.cta}`}>
          <div className={styles.container}>
            <div className={styles.ctaInner}>
              <div>
                <h2 className={styles.ctaTitle}>Bring a program. We’ll run it through live.</h2>
                <p className={styles.ctaSub}>
                  We will connect a sample export and produce a determination in front of you —
                  citations, the four methods, and the arithmetic behind each result.
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
                <Link className={`${styles.btn} ${styles.btnGhost} ${styles.btnLg}`} href="/idea-fiscal">
                  See the rules we evaluate
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
