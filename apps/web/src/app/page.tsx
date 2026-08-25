import Link from 'next/link';
import styles from './sales.module.css';
import { SiteHeader } from '@/components/marketing/site-header';
import {
  AlertIcon,
  CheckIcon,
  HistoryIcon,
  LayersIcon,
  LockIcon,
  ScaleIcon,
  ShieldIcon,
} from '@/components/marketing/icons';

const STATUSES = [
  {
    label: 'PASS',
    cls: 'sPass',
    desc: (
      <>
        The rule was evaluated and the subject <strong>meets the requirement</strong>.
      </>
    ),
  },
  {
    label: 'FAIL',
    cls: 'sFail',
    desc: (
      <>
        A requirement was <strong>affirmatively not met</strong> — surfaced with its authority.
      </>
    ),
  },
  {
    label: 'RISK',
    cls: 'sRisk',
    desc: (
      <>
        Conditions trend toward a finding and warrant <strong>review before an audit</strong>.
      </>
    ),
  },
  {
    label: 'INDETERMINATE',
    cls: 'sIndeterminate',
    desc: (
      <>
        Required data never arrived, so we say so — <strong>never a manufactured PASS</strong>.
      </>
    ),
  },
];

const FEATURES = [
  {
    icon: <LayersIcon />,
    title: 'Versioned rule packs',
    body: 'Regulations ship as immutable, dated packs — federal, state, and program layers — each with an effective window. Nothing is hard-coded in application logic.',
  },
  {
    icon: <ScaleIcon />,
    title: 'Every rule cites its authority',
    body: 'Each rule links to the statute or regulation it enforces. Findings are defensible because they carry the citation an auditor would ask for.',
  },
  {
    icon: <HistoryIcon />,
    title: 'Reproducible determinations',
    body: 'A determination is tied to the exact pack version that produced it. Re-run last quarter and get last quarter’s answer — not today’s rules applied backward.',
  },
];

const COVERAGE = [
  { name: 'IDEA Part B — Special Education', authority: '34 CFR Part 300', live: true },
  { name: 'IDEA Part C — Early Intervention', authority: '34 CFR Part 303', live: false },
  { name: 'Title I, Part A', authority: '20 U.S.C. § 6301', live: false },
  { name: 'State monitoring overlays', authority: 'per-state layer', live: false },
];

const PRICING = [
  {
    name: 'Program',
    desc: 'For a single district or early-intervention program getting audit-ready.',
    price: 'Custom',
    unit: 'per program',
    featured: false,
    features: ['IDEA-B rule pack', 'Up to 3 monitored entities', 'Determination history', 'Email support'],
    cta: 'Talk to sales',
  },
  {
    name: 'Agency',
    desc: 'For LEAs and regional agencies monitoring multiple entities at scale.',
    price: 'Custom',
    unit: 'per agency',
    featured: true,
    features: [
      'All federal + state layers',
      'Unlimited monitored entities',
      'Scoped, per-entity access control',
      'Audit-export packages',
      'Priority support & onboarding',
    ],
    cta: 'Request a demo',
  },
  {
    name: 'State',
    desc: 'For state education agencies overseeing every LEA in the state.',
    price: 'Custom',
    unit: 'statewide',
    featured: false,
    features: ['Statewide rollout', 'Custom state rule layers', 'SSO & data residency options', 'Dedicated success manager'],
    cta: 'Talk to sales',
  },
];

export default function Home() {
  return (
    <div className={styles.page}>
      <SiteHeader />

      <main>
        {/* Hero */}
        <section className={`${styles.container} ${styles.hero}`}>
          <span className={styles.heroBadge}>
            <span className={styles.dot} aria-hidden />
            Now shipping the federal IDEA Part B pack
          </span>

          <h1 className={styles.heroTitle}>
            Compliance assurance for <em>publicly funded education</em>.
          </h1>
          <p className={styles.heroSub}>
            ComplianceOS EDU turns the regulations governing special education and other funded
            programs into versioned, citable rule packs — so districts, agencies, and states can
            prove compliance instead of guessing at it.
          </p>

          <div className={styles.heroActions}>
            <a className={`${styles.btn} ${styles.btnPrimary} ${styles.btnLg}`} href="#contact">
              Request a demo
            </a>
            <Link className={`${styles.btn} ${styles.btnGhost} ${styles.btnLg}`} href="/registry">
              View the live registry
            </Link>
          </div>

          <div className={styles.heroMeta}>
            <div className={styles.heroMetaItem}>
              <span className={styles.heroMetaValue}>34 CFR 300</span>
              <span className={styles.heroMetaLabel}>Cited authority per rule</span>
            </div>
            <div className={styles.heroMetaItem}>
              <span className={styles.heroMetaValue}>6</span>
              <span className={styles.heroMetaLabel}>Honest determination states</span>
            </div>
            <div className={styles.heroMetaItem}>
              <span className={styles.heroMetaValue}>Versioned</span>
              <span className={styles.heroMetaLabel}>Every rule pack, every deploy</span>
            </div>
          </div>

          {/* Signature: the honest status system */}
          <div className={styles.statusPanel}>
            <div className={styles.statusPanelHead}>
              <span>determination.status</span>
              <span className={styles.statusPanelDots} aria-hidden>
                <span />
                <span />
                <span />
              </span>
            </div>
            <div className={styles.statusRows}>
              {STATUSES.map((s) => (
                <div className={styles.statusRow} key={s.label}>
                  <span className={`${styles.statusPill} ${styles[s.cls]}`}>{s.label}</span>
                  <span className={styles.statusDesc}>{s.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className={styles.section}>
          <div className={styles.container}>
            <p className={styles.eyebrow}>How it works</p>
            <h2 className={styles.sectionTitle}>Regulations as code you can audit, not trust blindly.</h2>
            <p className={styles.sectionLede}>
              The engine loads a committed rule pack, evaluates a subject against it, and reports
              exactly what it could and could not conclude. No rule runs without the authority behind
              it traveling with the result.
            </p>

            <div className={styles.grid}>
              {FEATURES.map((f) => (
                <article className={styles.card} key={f.title}>
                  <div className={styles.cardIcon}>{f.icon}</div>
                  <h3 className={styles.cardTitle}>{f.title}</h3>
                  <p className={styles.cardBody}>{f.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Honesty callout */}
        <section className={styles.section}>
          <div className={styles.container}>
            <p className={styles.eyebrow}>
              <AlertIcon size={13} style={{ verticalAlign: '-2px', marginRight: 6 }} />
              Why it’s different
            </p>
            <h2 className={styles.sectionTitle}>
              Missing data produces INDETERMINATE — never a manufactured PASS.
            </h2>
            <p className={styles.sectionLede}>
              A district should never be told it’s compliant on the strength of data that never
              arrived. Unanswerable rules outrank passing ones in every roll-up, so a green summary
              always means the same thing: the evidence was there and it held.
            </p>
          </div>
        </section>

        {/* Security */}
        <section id="security" className={styles.section}>
          <div className={`${styles.container} ${styles.split}`}>
            <div>
              <p className={styles.eyebrow}>Security &amp; tenancy</p>
              <h2 className={styles.sectionTitle}>Access is explicit. Hierarchy is not permission.</h2>
              <p className={styles.sectionLede}>
                A state agency sitting above a district does not automatically see that district’s
                data. Every scope grants access to exactly the organization it names — an invariant
                enforced in code, not just policy.
              </p>
              <ul className={styles.checkList}>
                <li>
                  <ShieldIcon size={18} />
                  <span>
                    <strong>Per-entity scopes.</strong> Access is granted to one organization at a
                    time — parents never inherit their children’s data.
                  </span>
                </li>
                <li>
                  <LockIcon size={18} />
                  <span>
                    <strong>Tenant isolation.</strong> Every scope is bound to a tenant and an
                    organization; nothing resolves across that boundary.
                  </span>
                </li>
                <li>
                  <CheckIcon size={18} />
                  <span>
                    <strong>Auditable by design.</strong> Determinations, authorities, and pack
                    versions travel together, ready to hand to a monitor.
                  </span>
                </li>
              </ul>
            </div>

            <div className={styles.codePanel} aria-hidden>
              <div className={styles.codePanelHead}>access-control.ts</div>
              <pre className={styles.codeBody}>
                <code>
                  <span className={styles.cmt}>{'// A parent org never inherits child access.'}</span>
                  {'\n'}
                  <span className={styles.kw}>const</span> canSee = grantsAccessTo(scopes, {'{'}
                  {'\n'}
                  {'  '}tenantId,{'\n'}
                  {'  '}organizationId,{'\n'}
                  {'}'});{'\n\n'}
                  state → district{'  '}
                  <span className={styles.no}>{'// denied'}</span>
                  {'\n'}
                  district → self{'   '}
                  <span className={styles.ok}>{'// granted'}</span>
                </code>
              </pre>
            </div>
          </div>
        </section>

        {/* Coverage */}
        <section id="coverage" className={styles.section}>
          <div className={styles.container}>
            <p className={styles.eyebrow}>Coverage</p>
            <h2 className={styles.sectionTitle}>Federal packs today, more layers on the way.</h2>
            <p className={styles.sectionLede}>
              We start where the audit risk is highest and expand outward. Each pack is reviewed
              before its rules leave the registry.
            </p>

            <div className={styles.coverageList}>
              {COVERAGE.map((c) => (
                <div className={styles.coverageItem} key={c.name}>
                  <div>
                    <div className={styles.coverageName}>{c.name}</div>
                    <div className={styles.coverageAuthority}>{c.authority}</div>
                  </div>
                  <span className={c.live ? styles.badgeLive : styles.badgeSoon}>
                    {c.live ? 'Live' : 'On roadmap'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className={styles.section}>
          <div className={styles.container}>
            <p className={styles.eyebrow}>Pricing</p>
            <h2 className={styles.sectionTitle}>Priced to the scope you monitor.</h2>
            <p className={styles.sectionLede}>
              Every plan is sized to the number of entities you oversee and the layers you need.
              Talk to us and we’ll scope it with you.
            </p>

            <div className={styles.pricing}>
              {PRICING.map((p) => (
                <div
                  className={`${styles.priceCard} ${p.featured ? styles.priceCardFeatured : ''}`}
                  key={p.name}
                >
                  {p.featured && <span className={styles.priceTag}>Most common</span>}
                  <h3 className={styles.priceName}>{p.name}</h3>
                  <p className={styles.priceDesc}>{p.desc}</p>
                  <div className={styles.priceValue}>
                    <strong>{p.price}</strong>
                    <span>{p.unit}</span>
                  </div>
                  <ul className={styles.priceFeatures}>
                    {p.features.map((feat) => (
                      <li key={feat}>
                        <CheckIcon size={16} />
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>
                  <div className={styles.priceCta}>
                    <a
                      className={`${styles.btn} ${p.featured ? styles.btnPrimary : styles.btnGhost}`}
                      href="#contact"
                    >
                      {p.cta}
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section id="contact" className={styles.section}>
          <div className={styles.container}>
            <div className={styles.ctaBanner}>
              <h2 className={styles.ctaTitle}>See a determination you could hand to an auditor.</h2>
              <p className={styles.ctaSub}>
                Bring a program you monitor and we’ll walk it through the IDEA-B pack live — citations,
                statuses, and all.
              </p>
              <div className={styles.ctaActions}>
                <a className={`${styles.btn} ${styles.btnPrimary} ${styles.btnLg}`} href="mailto:sales@complianceos.edu">
                  Request a demo
                </a>
                <Link className={`${styles.btn} ${styles.btnGhost} ${styles.btnLg}`} href="/registry">
                  Explore the live registry
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={`${styles.container} ${styles.footerInner}`}>
          <p className={styles.footerNote}>
            ComplianceOS EDU — compliance assurance for publicly funded education programs. Phase 0
            baseline; rules are pending legal review before evaluation.
          </p>
          <nav className={styles.footerLinks} aria-label="Footer">
            <Link href="/registry">Registry</Link>
            <a href="#how">How it works</a>
            <a href="#pricing">Pricing</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
