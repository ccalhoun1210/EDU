import Link from 'next/link';
import styles from './sales.module.css';
import { SiteHeader } from '@/components/marketing/site-header';
import { Docket } from '@/components/marketing/docket';
import {
  ArrowRightIcon,
  CheckIcon,
  FailGlyph,
  FileCheckIcon,
  IndeterminateGlyph,
  LockIcon,
  ManualReviewGlyph,
  NoWriteIcon,
  NotApplicableGlyph,
  PassGlyph,
  RiskGlyph,
  ShieldIcon,
} from '@/components/marketing/icons';

/* The full six-state evaluation vocabulary. Each state has a distinct glyph
   AND a text label — meaning never rides on color alone (WCAG 1.4.1). */
const STATUS_LEGEND = [
  {
    label: 'PASS',
    cls: 'stPass',
    Glyph: PassGlyph,
    body: 'The requirement was evaluated and the evidence shows it is met.',
  },
  {
    label: 'FAIL',
    cls: 'stFail',
    Glyph: FailGlyph,
    body: 'A requirement was affirmatively not met. Surfaced with its citation.',
  },
  {
    label: 'RISK',
    cls: 'stRisk',
    Glyph: RiskGlyph,
    body: 'A real finding: conditions trend toward non-compliance and warrant review.',
  },
  {
    label: 'INDETERMINATE',
    cls: 'stIndeterminate',
    Glyph: IndeterminateGlyph,
    body: 'Required evidence never arrived. Neutral — not a failure, and never a false PASS.',
  },
  {
    label: 'MANUAL REVIEW',
    cls: 'stManual',
    Glyph: ManualReviewGlyph,
    body: 'The rule needs a human judgment the engine will not fabricate.',
  },
  {
    label: 'NOT APPLICABLE',
    cls: 'stNa',
    Glyph: NotApplicableGlyph,
    body: 'The requirement does not apply to this subject in this period.',
  },
];

const TERMS = [
  {
    name: 'Maintenance of Effort',
    abbr: 'MOE',
    desc: 'Did the district maintain required local or state-and-local special-education spending year over year?',
  },
  {
    name: 'Excess Cost',
    abbr: 'Excess cost',
    desc: 'Was the minimum average per-pupil amount spent before IDEA funds were applied?',
  },
  {
    name: 'Proportionate Share',
    abbr: 'Prop. share',
    desc: 'Was the mandated share of IDEA funds reserved for parentally-placed private-school children?',
  },
  {
    name: 'Coordinated Early Intervening',
    abbr: 'CEIS',
    desc: 'Were CEIS funds tracked and capped correctly, including any required set-aside?',
  },
];

const COVERAGE = [
  { name: 'IDEA Part B — Maintenance of Effort', authority: '34 CFR §300.203', live: true },
  { name: 'IDEA Part B — Excess Cost', authority: '34 CFR §300.16', live: true },
  { name: 'IDEA Part B — Proportionate Share', authority: '34 CFR §300.133', live: true },
  { name: 'IDEA Part B — CEIS', authority: '34 CFR §300.226', live: false },
  { name: 'IDEA Part C — Early Intervention', authority: '34 CFR Part 303', live: false },
];

const TRUST = [
  {
    Icon: LockIcon,
    title: 'FERPA contractual terms',
    desc: 'Student-level data handled under a data-privacy agreement, isolated by tenant and organization.',
    status: 'In every contract',
  },
  {
    Icon: ShieldIcon,
    title: 'Student Privacy Pledge',
    desc: 'We commit to the industry privacy standard districts already screen vendors against.',
    status: 'Signatory — pending',
  },
  {
    Icon: FileCheckIcon,
    title: 'Accessibility conformance',
    desc: 'Built to WCAG 2.1 AA. An Accessibility Conformance Report (VPAT) is authored against our product.',
    status: 'ACR in progress',
  },
  {
    Icon: CheckIcon,
    title: 'SOC 2',
    desc: 'Security controls aligned to SOC 2 Type II criteria for how we store and process agency data.',
    status: 'Type II — in progress',
  },
  {
    Icon: ShieldIcon,
    title: 'Data residency',
    desc: 'U.S.-based data storage with documented sub-processors available on request.',
    status: 'U.S. region',
  },
  {
    Icon: NoWriteIcon,
    title: 'Read-only by design',
    desc: 'We never write back to your SIS or IEP system. Nothing we do can alter your systems of record.',
    status: 'Architectural',
  },
];

export default function Home() {
  return (
    <div className={styles.page}>
      <a className={styles.skipLink} href="#main">
        Skip to content
      </a>
      <SiteHeader />

      <main id="main">
        {/* ---------- Hero: lead with the question, exhibit as proof ---------- */}
        <section className={styles.hero}>
          <div className={styles.container}>
            <div className={styles.heroGrid}>
              <div>
                <p className={styles.heroDocket}>
                  <span>
                    Scope: <b>IDEA Part B fiscal</b>
                  </span>
                  <span>
                    Authority: <b>34 CFR §300</b>
                  </span>
                  <span>
                    Rule pack: <b>idea-part-b@2024.1</b>
                  </span>
                </p>
                <h1 className={styles.heroTitle}>
                  If this district were <em>monitored today</em>, would it pass?
                </h1>
                <p className={styles.heroSub}>
                  ComplianceOS EDU evaluates your special-education fiscal data against the federal
                  rules a state monitor applies — Maintenance of Effort, excess cost, proportionate
                  share — and returns a determination with the citation and arithmetic behind it.
                </p>
                <div className={styles.heroActions}>
                  <a className={`${styles.btn} ${styles.btnPrimary} ${styles.btnLg}`} href="#contact">
                    Request a demo
                    <ArrowRightIcon size={18} />
                  </a>
                  <a className={`${styles.btn} ${styles.btnGhost} ${styles.btnLg}`} href="#result">
                    See a worked result
                  </a>
                </div>
                <p className={styles.heroNote}>
                  <NoWriteIcon size={16} />
                  Read-only — we never write back to your SIS or IEP system.
                </p>
              </div>

              {/* Signature asset: a determination rendered as a formal exhibit */}
              <aside className={styles.exhibit} aria-label="Example determination exhibit">
                <div className={styles.exhibitHead}>
                  <b>Exhibit A — Determination</b>
                  <span>DET-2024-0417</span>
                </div>
                <div className={styles.exhibitStamp}>
                  <span className={styles.stampMark}>
                    <FailGlyph size={20} />
                    FAIL
                  </span>
                  <span className={styles.exhibitStampCaption}>
                    <b>Maintenance of Effort not met</b>
                    Local expenditure fell below the prior-year floor.
                  </span>
                </div>
                <div className={styles.exLedger}>
                  <div className={styles.exRow}>
                    <span className={styles.exKey}>Authority</span>
                    <span className={styles.exVal}>34 CFR §300.203(b)</span>
                  </div>
                  <div className={styles.exRow}>
                    <span className={styles.exKey}>Rule pack</span>
                    <span className={styles.exVal}>idea-part-b@2024.1</span>
                  </div>
                  <div className={styles.exRow}>
                    <span className={styles.exKey}>Subject</span>
                    <span className={styles.exVal}>LEA 04170 · FY2024</span>
                  </div>
                </div>
                <div className={styles.exArith}>
                  required&nbsp;≥ $4,120,000
                  <br />
                  actual&nbsp;&nbsp;&nbsp;&nbsp;= $3,960,000
                  <br />
                  shortfall&nbsp;= <span className={styles.neg}>$160,000</span> → FAIL
                </div>
                <div className={styles.exFoot}>
                  <CheckIcon size={14} />
                  Machine-evaluated · reproducible from the pinned rule pack
                </div>
              </aside>
            </div>
          </div>
        </section>

        {/* ---------- The problem, in their vocabulary ---------- */}
        <section id="problem" className={`${styles.section} ${styles.sectionRule}`}>
          <div className={styles.container}>
            <Docket
              no="§ 01"
              tag="The vocabulary"
              title="You already know the tests. So does the engine."
              lede="These are the checks a state monitor runs against IDEA Part B fiscal data — and the ones a spreadsheet quietly gets wrong. Each is encoded against the regulation it comes from."
            />
            <div className={styles.termList}>
              {TERMS.map((t, i) => (
                <div className={styles.termRow} key={t.abbr}>
                  <span className={styles.termIndex}>{String(i + 1).padStart(2, '0')}</span>
                  <span className={styles.termHead}>
                    <span className={styles.termName}>{t.name}</span>
                    <span className={styles.termAbbr}>{t.abbr}</span>
                  </span>
                  <p className={styles.termDesc}>{t.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- Six-state status system ---------- */}
        <section className={`${styles.section} ${styles.sectionAlt} ${styles.sectionRule}`}>
          <div className={styles.container}>
            <Docket
              no="§ 02"
              tag="Determination states"
              title="Six outcomes — and INDETERMINATE is not a failure."
              lede="A spreadsheet gives you two answers and hides the third. This is the outcome the product exists to protect: when required evidence is missing, it says so plainly instead of manufacturing a passing result you cannot defend."
            />
            <div className={styles.legend}>
              {STATUS_LEGEND.map(({ label, cls, Glyph, body }) => (
                <div className={styles.legendRow} key={label}>
                  <span className={`${styles.statusBadge} ${styles[cls]}`}>
                    <Glyph size={15} />
                    {label}
                  </span>
                  <p className={styles.legendText}>{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- A worked result (anchor target) ---------- */}
        <section id="result" className={`${styles.section} ${styles.sectionRule}`}>
          <div className={styles.container}>
            <Docket
              no="§ 03"
              tag="A worked result"
              title="Every determination shows its work — like Exhibit A."
              lede="Status, the citation a hearing officer would ask for, the exact rule-pack version that produced it, the inputs, and the arithmetic. No competitor screenshot looks like this, because no competitor binds the answer to its authority."
            />
            <div className={styles.heroActions}>
              <Link className={`${styles.btn} ${styles.btnGhost} ${styles.btnLg}`} href="/registry">
                Open the rule registry
                <ArrowRightIcon size={18} />
              </Link>
            </div>
          </div>
        </section>

        {/* ---------- What it does NOT do ---------- */}
        <section className={`${styles.section} ${styles.sectionAlt} ${styles.sectionRule}`}>
          <div className={styles.container}>
            <Docket
              no="§ 04"
              tag="Limits & guarantees"
              title="The limits are the point."
              lede="A compliance tool earns trust by what it refuses to touch. These are guarantees, not gaps."
            />
            <div className={styles.notGrid}>
              <div className={styles.notCard}>
                <span className={styles.notIcon}>
                  <NoWriteIcon size={20} />
                </span>
                <h3>It never writes to your systems of record</h3>
                <p>
                  ComplianceOS EDU reads a copy of your fiscal and student data. It cannot alter your
                  SIS, your IEP system, or your general ledger. Nothing it does can create a new
                  compliance problem in the systems you rely on.
                </p>
              </div>
              <div className={styles.notCard}>
                <span className={styles.notIcon}>
                  <IndeterminateGlyph size={20} />
                </span>
                <h3>It never guesses to fill a gap</h3>
                <p>
                  When a required input is missing, the engine returns INDETERMINATE and names what
                  it needs. It will not infer, interpolate, or round a shortfall away to produce a
                  cleaner-looking report.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ---------- Trust row ---------- */}
        <section id="trust" className={`${styles.section} ${styles.sectionRule}`}>
          <div className={styles.container}>
            <Docket
              no="§ 05"
              tag="Trust & security"
              title="The row a district reads before anything else."
              lede="Everything here is stated at its true status. We would rather show an honest “in progress” than an unbacked badge — the same standard we hold your determinations to."
            />
            <div className={styles.trustList}>
              {TRUST.map(({ Icon, title, desc, status }) => (
                <div className={styles.trustRow} key={title}>
                  <span className={styles.trustIcon}>
                    <Icon size={20} />
                  </span>
                  <p className={styles.trustTitle}>{title}</p>
                  <p className={styles.trustDesc}>{desc}</p>
                  <span className={styles.trustStatus}>{status}</span>
                </div>
              ))}
            </div>

            {/* Proof slot — designed, left unpublished until a named pilot exists */}
            <figure className={styles.proof}>
              <p className={styles.proofLabel}>Practitioner proof — reserved for a named pilot</p>
              <blockquote className={styles.proofQuote}>
                “A district director, attributed by name and district, describes catching a finding
                before their state monitoring visit.”
              </blockquote>
              <figcaption className={styles.proofAttr}>
                We leave this slot empty rather than fill it with a stock quote.
              </figcaption>
            </figure>
          </div>
        </section>

        {/* ---------- Coverage ---------- */}
        <section id="coverage" className={`${styles.section} ${styles.sectionAlt} ${styles.sectionRule}`}>
          <div className={styles.container}>
            <Docket
              no="§ 06"
              tag="Coverage register"
              title="Federal IDEA Part B fiscal rules today."
              lede="We begin where audit risk is highest and expand outward. Each rule pack undergoes legal review before it leaves the registry."
            />
            <div className={styles.coverageWrap}>
              <table className={styles.coverageTable}>
                <thead>
                  <tr>
                    <th scope="col">Requirement</th>
                    <th scope="col">Authority</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {COVERAGE.map((c) => (
                    <tr key={c.name}>
                      <td>{c.name}</td>
                      <td className={styles.coverageCite}>{c.authority}</td>
                      <td>
                        <span className={`${styles.statusBadge} ${c.live ? styles.stPass : styles.stNa}`}>
                          {c.live ? <PassGlyph size={14} /> : <NotApplicableGlyph size={14} />}
                          {c.live ? 'Available' : 'On roadmap'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ---------- CTA ---------- */}
        <section id="contact" className={`${styles.section} ${styles.cta}`}>
          <div className={styles.container}>
            <div className={styles.sectionRule} style={{ paddingTop: '1.25rem' }}>
              <div className={styles.ctaInner}>
                <div>
                  <h2 className={styles.ctaTitle}>See a determination you could hand to a monitor.</h2>
                  <p className={styles.ctaSub}>
                    Bring a program you oversee and we will walk it through the IDEA Part B rule pack
                    live — citations, statuses, and the arithmetic behind each result.
                  </p>
                </div>
                <div className={styles.ctaActions}>
                  <a
                    className={`${styles.btn} ${styles.btnPrimary} ${styles.btnLg}`}
                    href="mailto:demo@complianceos.edu?subject=ComplianceOS%20EDU%20demo"
                  >
                    Request a demo
                  </a>
                  <a
                    className={`${styles.btn} ${styles.btnGhost} ${styles.btnLg}`}
                    href="mailto:states@complianceos.edu?subject=State%20rules%20conversation"
                  >
                    Talk to us about your state
                  </a>
                  <p className={styles.ctaFine}>
                    State rules differ. The second conversation is for SEA-adjacent buyers who need to
                    know we can model theirs.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.container}>
          <div className={styles.footerGrid}>
            <div className={styles.footerBrand}>
              <span className={styles.brandName}>
                ComplianceOS <span>EDU</span>
              </span>
              <p className={styles.footerBlurb}>
                Compliance assurance for publicly funded education programs. Versioned rule packs,
                cited authorities, and determinations you can defend in a monitoring visit.
              </p>
            </div>
            <div className={styles.footerCol}>
              <h4>Product</h4>
              <ul>
                <li>
                  <a href="#problem">The vocabulary</a>
                </li>
                <li>
                  <a href="#result">A worked result</a>
                </li>
                <li>
                  <a href="#coverage">Coverage</a>
                </li>
                <li>
                  <Link href="/registry">Rule registry</Link>
                </li>
                <li>
                  <Link href="/pricing">Pricing</Link>
                </li>
              </ul>
            </div>
            <div className={styles.footerCol}>
              <h4>Trust</h4>
              <ul>
                <li>
                  <a href="#trust">Security &amp; privacy</a>
                </li>
                <li>
                  <a href="#trust">Accessibility statement</a>
                </li>
                <li>
                  <a href="mailto:demo@complianceos.edu">Request a demo</a>
                </li>
                <li>
                  <a href="mailto:states@complianceos.edu">Talk to us about your state</a>
                </li>
              </ul>
            </div>
          </div>
          <div className={styles.footerBar}>
            <p className={styles.footerStatement}>
              ComplianceOS EDU is an independent software vendor and is not a government agency. Our
              rule packs cite the controlling authority and are reviewed before release; a
              determination is decision-support, not legal advice.
            </p>
            <span>© 2026 ComplianceOS EDU</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
