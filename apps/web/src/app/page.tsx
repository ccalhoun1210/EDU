import Link from 'next/link';
import styles from './sales.module.css';
import { SiteHeader } from '@/components/marketing/site-header';
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
    status: 'Standard in every contract',
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
    status: 'Architectural guarantee',
  },
];

export default function Home() {
  return (
    <div className={styles.page}>
      <SiteHeader />

      <main id="main">
        {/* ---------- Hero: lead with the question, not a feature ---------- */}
        <section className={styles.hero}>
          <div className={styles.container}>
            <div className={styles.heroGrid}>
              <div>
                <span className={styles.heroEyebrow}>For IDEA Part B fiscal compliance</span>
                <h1 className={styles.heroTitle}>
                  If this district were <em>monitored today</em>, would it pass?
                </h1>
                <p className={styles.heroSub}>
                  ComplianceOS EDU evaluates your special-education fiscal data against the federal
                  rules a state monitor applies — Maintenance of Effort, excess cost, proportionate
                  share — and shows the citation and arithmetic behind every result.
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
                  Read-only. We never write back to your SIS or IEP system.
                </p>

                <div className={styles.chips}>
                  <span className={styles.chip}>34 CFR §300.203</span>
                  <span className={styles.chip}>34 CFR §300.16</span>
                  <span className={styles.chip}>34 CFR §300.133</span>
                </div>
              </div>

              {/* Signature asset: the worked "Why" panel */}
              <aside className={styles.whyCard} aria-label="Example determination detail">
                <div className={styles.whyHead}>
                  <span className={styles.whyHeadLabel}>Why this result</span>
                  <span className={styles.whyRuleId}>MOE-LOCAL-2024</span>
                </div>
                <div className={styles.whyBody}>
                  <div className={styles.whyRow}>
                    <span className={styles.whyKey}>Determination</span>
                    <span className={styles.whyVal}>
                      <span className={`${styles.statusBadge} ${styles.stFail} ${styles.statusLg}`}>
                        <FailGlyph size={16} />
                        FAIL
                      </span>
                    </span>
                  </div>
                  <div className={styles.whyRow}>
                    <span className={styles.whyKey}>Authority</span>
                    <span className={`${styles.whyVal} ${styles.whyMono}`}>34 CFR §300.203(b)</span>
                  </div>
                  <div className={styles.whyRow}>
                    <span className={styles.whyKey}>Rule pack</span>
                    <span className={`${styles.whyVal} ${styles.whyMono}`}>idea-part-b@2024.1</span>
                  </div>
                  <div className={styles.whyRow}>
                    <span className={styles.whyKey}>Inputs</span>
                    <span className={styles.whyVal}>
                      Prior-year local: $4,120,000 · Current-year local: $3,960,000
                    </span>
                  </div>
                  <div className={styles.whyRow}>
                    <span className={styles.whyKey}>Arithmetic</span>
                    <span className={styles.whyVal}>
                      <span className={styles.whyArith}>
                        required ≥ $4,120,000
                        <br />
                        actual&nbsp;&nbsp;&nbsp;= $3,960,000
                        <br />
                        shortfall = <b>$160,000</b> → FAIL
                      </span>
                    </span>
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </section>

        {/* ---------- The problem, in their vocabulary ---------- */}
        <section id="problem" className={styles.section}>
          <div className={styles.container}>
            <p className={styles.kicker}>The problem</p>
            <h2 className={styles.sectionTitle}>
              You already know the vocabulary. So does the engine.
            </h2>
            <p className={styles.sectionLede}>
              These are the tests a state monitor runs against IDEA Part B fiscal data — and the
              ones a spreadsheet quietly gets wrong. ComplianceOS EDU encodes each one against the
              regulation it comes from.
            </p>
            <div className={styles.termGrid}>
              {TERMS.map((t) => (
                <div className={styles.term} key={t.abbr}>
                  <p className={styles.termName}>{t.name}</p>
                  <span className={styles.termAbbr}>{t.abbr}</span>
                  <p className={styles.termDesc}>{t.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- Six-state status system ---------- */}
        <section className={`${styles.section} ${styles.sectionAlt}`}>
          <div className={styles.container}>
            <p className={styles.kicker}>Honest determinations</p>
            <h2 className={styles.sectionTitle}>
              Six outcomes — and INDETERMINATE is not a failure.
            </h2>
            <p className={styles.sectionLede}>
              A spreadsheet gives you two answers and hides the third. This is the outcome the
              product exists to protect: when required evidence is missing, it says so plainly
              instead of manufacturing a passing result you cannot defend.
            </p>
            <div className={styles.legend}>
              {STATUS_LEGEND.map(({ label, cls, Glyph, body }) => (
                <div className={styles.legendItem} key={label}>
                  <span className={`${styles.statusBadge} ${styles[cls]}`}>
                    <Glyph size={16} />
                    {label}
                  </span>
                  <span className={styles.legendText}>
                    <strong>{label}</strong>
                    {body}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- A worked result (anchor target) ---------- */}
        <section id="result" className={styles.section}>
          <div className={styles.container}>
            <p className={styles.kicker}>A worked result</p>
            <h2 className={styles.sectionTitle}>
              Every determination shows its work — like the panel above.
            </h2>
            <p className={styles.sectionLede}>
              Status, the citation a hearing officer would ask for, the exact rule-pack version that
              produced it, the inputs, the arithmetic, and the source rows. No competitor screenshot
              looks like this because no competitor binds the answer to its authority. Explore live
              determinations in the rule registry.
            </p>
            <div className={styles.heroActions} style={{ marginTop: '1.75rem' }}>
              <Link className={`${styles.btn} ${styles.btnGhost} ${styles.btnLg}`} href="/registry">
                Open the rule registry
                <ArrowRightIcon size={18} />
              </Link>
            </div>
          </div>
        </section>

        {/* ---------- What it does NOT do ---------- */}
        <section className={`${styles.section} ${styles.sectionAlt}`}>
          <div className={styles.container}>
            <p className={styles.kicker}>What it does not do</p>
            <h2 className={styles.sectionTitle}>The limits are the point.</h2>
            <p className={styles.sectionLede}>
              A compliance tool earns trust by what it refuses to touch. These are guarantees, not
              gaps.
            </p>
            <div className={styles.notGrid}>
              <div className={styles.notCard}>
                <span className={styles.notIcon}>
                  <NoWriteIcon size={22} />
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
                  <IndeterminateGlyph size={22} />
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
        <section id="trust" className={styles.section}>
          <div className={styles.container}>
            <p className={styles.kicker}>Trust &amp; security</p>
            <h2 className={styles.sectionTitle}>The row a district reads before anything else.</h2>
            <p className={styles.sectionLede}>
              Everything here is stated at its true status. We would rather show an honest
              &ldquo;in progress&rdquo; than an unbacked badge — the same standard we hold your
              determinations to.
            </p>
            <div className={styles.trustGrid}>
              {TRUST.map(({ Icon, title, desc, status }) => (
                <div className={styles.trustCard} key={title}>
                  <span className={styles.trustIcon}>
                    <Icon size={22} />
                  </span>
                  <div>
                    <p className={styles.trustTitle}>{title}</p>
                    <p className={styles.trustDesc}>{desc}</p>
                    <span className={styles.trustStatus}>{status}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Proof slot — designed, left unpublished until a named pilot exists */}
            <figure className={styles.proof}>
              <p className={styles.proofLabel}>Practitioner proof — reserved for a named pilot</p>
              <blockquote className={styles.proofQuote}>
                &ldquo;A district director, attributed by name and district, describes catching a
                finding before their state monitoring visit.&rdquo;
              </blockquote>
              <figcaption className={styles.proofAttr}>
                We leave this slot empty rather than fill it with a stock quote.
              </figcaption>
            </figure>
          </div>
        </section>

        {/* ---------- Coverage ---------- */}
        <section id="coverage" className={`${styles.section} ${styles.sectionAlt}`}>
          <div className={styles.container}>
            <p className={styles.kicker}>Coverage</p>
            <h2 className={styles.sectionTitle}>Federal IDEA Part B fiscal rules today.</h2>
            <p className={styles.sectionLede}>
              We begin where audit risk is highest and expand outward. Each rule pack undergoes legal
              review before it leaves the registry.
            </p>
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
                          {c.live ? <PassGlyph size={15} /> : <NotApplicableGlyph size={15} />}
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
                  <a href="#problem">The problem</a>
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
              ComplianceOS EDU is an independent software vendor and is not a government agency. It
              conforms to WCAG 2.1 Level AA; an Accessibility Conformance Report is available on
              request. Statutory citations are provided for reference and do not constitute legal
              advice.
            </p>
            <span>© {new Date().getFullYear()} ComplianceOS EDU</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
