import Link from 'next/link';
import styles from './sales.module.css';
import { SiteHeader } from '@/components/marketing/site-header';
import {
  AlertIcon,
  ArrowRightIcon,
  CapitolIcon,
  CheckIcon,
  FileCheckIcon,
  HistoryIcon,
  LayersIcon,
  LockIcon,
  ScaleIcon,
  ServerIcon,
  ShieldIcon,
  UsersIcon,
} from '@/components/marketing/icons';

const STATUSES = [
  {
    label: 'PASS',
    cls: 'sPass',
    desc: (
      <>
        The requirement was evaluated and the subject <strong>meets it</strong>.
      </>
    ),
  },
  {
    label: 'FAIL',
    cls: 'sFail',
    desc: (
      <>
        A requirement was <strong>affirmatively not met</strong>, surfaced with its authority.
      </>
    ),
  },
  {
    label: 'RISK',
    cls: 'sRisk',
    desc: (
      <>
        Conditions trend toward a finding and warrant <strong>review before monitoring</strong>.
      </>
    ),
  },
  {
    label: 'INDETERMINATE',
    cls: 'sIndeterminate',
    desc: (
      <>
        Required evidence never arrived, so the system says so — <strong>never a false PASS</strong>.
      </>
    ),
  },
];

const CAPABILITIES = [
  {
    icon: <LayersIcon />,
    title: 'Versioned rule packs',
    body: 'Federal, state, and program requirements ship as immutable, dated packs with an effective window. Regulations are never buried in application logic.',
  },
  {
    icon: <ScaleIcon />,
    title: 'Every rule cites its authority',
    body: 'Each rule links to the statute or regulation it enforces, so every finding carries the citation a monitor or hearing officer would ask for.',
  },
  {
    icon: <HistoryIcon />,
    title: 'Reproducible determinations',
    body: 'A determination is bound to the exact pack version that produced it. Re-run a prior period and receive that period’s answer — not today’s rules applied backward.',
  },
];

const AUDIENCE = [
  {
    tier: 'State Education Agencies',
    icon: <CapitolIcon size={22} />,
    title: 'Statewide oversight',
    body: 'Monitor every local agency against a common, versioned rule set and produce defensible determinations for federal reporting.',
  },
  {
    tier: 'Local Education Agencies',
    icon: <UsersIcon size={22} />,
    title: 'District readiness',
    body: 'Know where a program stands against IDEA and Title I requirements before a monitoring visit — with the citation behind every result.',
  },
  {
    tier: 'Early-Intervention Programs',
    icon: <FileCheckIcon size={22} />,
    title: 'Part C assurance',
    body: 'Track requirement-level compliance across served children and surface gaps while there is still time to correct them.',
  },
];

const COVERAGE = [
  { name: 'IDEA Part B — Special Education', authority: '34 CFR Part 300', live: true },
  { name: 'IDEA Part C — Early Intervention', authority: '34 CFR Part 303', live: false },
  { name: 'Title I, Part A', authority: '20 U.S.C. § 6301 et seq.', live: false },
  { name: 'State monitoring overlays', authority: 'Per-state regulatory layer', live: false },
];

const TIERS = [
  {
    name: 'Program',
    desc: 'For a single district or early-intervention program preparing for monitoring.',
    price: 'Scoped',
    unit: 'per program',
    featured: false,
    features: ['IDEA Part B rule pack', 'Up to 3 monitored entities', 'Determination history', 'Standard support'],
    cta: 'Contact us',
  },
  {
    name: 'Agency',
    desc: 'For local and regional agencies monitoring multiple entities across programs.',
    price: 'Scoped',
    unit: 'per agency',
    featured: true,
    features: [
      'All federal + state layers',
      'Unlimited monitored entities',
      'Per-entity scoped access control',
      'Audit-export packages',
      'Priority onboarding',
    ],
    cta: 'Request a demonstration',
  },
  {
    name: 'Statewide',
    desc: 'For state education agencies overseeing every local agency in the state.',
    price: 'Scoped',
    unit: 'statewide',
    featured: false,
    features: ['Statewide rollout', 'Custom state rule layers', 'SSO & data-residency options', 'Dedicated program manager'],
    cta: 'Contact us',
  },
];

export default function Home() {
  return (
    <div className={styles.page}>
      {/* Official notice banner */}
      <div className={styles.govBanner}>
        <div className={styles.container}>
          <details className={styles.govDetails}>
            <summary className={styles.govBannerRow}>
              <span className={styles.govFlag} aria-hidden>
                ★
              </span>
              <span className={styles.govBannerText}>
                A compliance platform built for state &amp; local education agencies.
              </span>
              <span className={styles.govBannerToggle}>Here’s how it protects you</span>
            </summary>
            <div className={styles.govExpand}>
              <div className={styles.govExpandItem}>
                <ScaleIcon size={20} />
                <span>
                  <strong>Grounded in authority.</strong> Every determination is tied to the
                  statute or regulation it enforces and the exact rule-pack version that produced
                  it — reproducible on demand.
                </span>
              </div>
              <div className={styles.govExpandItem}>
                <LockIcon size={20} />
                <span>
                  <strong>Secure &amp; scoped.</strong> Student-level data is isolated by tenant and
                  organization. Access is granted explicitly, never inherited through hierarchy.
                </span>
              </div>
            </div>
          </details>
        </div>
      </div>

      <SiteHeader />

      <main>
        {/* Hero */}
        <section className={`${styles.container} ${styles.hero}`}>
          <div className={styles.heroGrid}>
            <div>
              <span className={styles.heroBadge}>
                Now available — Federal IDEA Part B rule pack
              </span>

              <h1 className={styles.heroTitle}>
                Prove compliance for <em>publicly funded education</em>.
              </h1>
              <p className={styles.heroSub}>
                ComplianceOS EDU turns the regulations governing special education and other funded
                programs into versioned, citable rule packs — so districts, agencies, and states can
                demonstrate compliance with confidence, not guesswork.
              </p>

              <div className={styles.heroActions}>
                <a className={`${styles.btn} ${styles.btnPrimary} ${styles.btnLg}`} href="#contact">
                  Request a demonstration
                  <ArrowRightIcon size={18} />
                </a>
                <Link className={`${styles.btn} ${styles.btnGhost} ${styles.btnLg}`} href="/registry">
                  View the rule registry
                </Link>
              </div>

              <div className={styles.heroAuthorities}>
                <p className={styles.heroAuthoritiesLabel}>Grounded in federal authority</p>
                <div className={styles.heroAuthoritiesRow}>
                  <span className={styles.authorityChip}>
                    34 CFR Part 300<span>IDEA Part B</span>
                  </span>
                  <span className={styles.authorityChip}>
                    34 CFR Part 303<span>IDEA Part C</span>
                  </span>
                  <span className={styles.authorityChip}>
                    20 U.S.C. § 6301<span>Title I, Part A</span>
                  </span>
                </div>
              </div>
            </div>

            {/* Signature: honest determination card */}
            <aside className={styles.statusPanel} aria-label="Determination outcomes">
              <div className={styles.statusPanelHead}>
                <span className={styles.statusPanelTitle}>Determination outcomes</span>
                <span className={styles.statusPanelMeta}>IDEA-B · v2024.1</span>
              </div>
              <div className={styles.statusRows}>
                {STATUSES.map((s) => (
                  <div className={styles.statusRow} key={s.label}>
                    <span className={`${styles.statusPill} ${styles[s.cls]}`}>{s.label}</span>
                    <span className={styles.statusDesc}>{s.desc}</span>
                  </div>
                ))}
              </div>
              <div className={styles.statusFoot}>
                Unanswerable requirements outrank passing ones in every roll-up. A compliant summary
                always means the same thing: the evidence was present and it held.
              </div>
            </aside>
          </div>
        </section>

        {/* Mandate */}
        <section id="mandate" className={styles.section}>
          <div className={styles.container}>
            <p className={styles.eyebrow}>The mandate</p>
            <h2 className={styles.sectionTitle}>Regulations as evidence you can audit — not trust blindly.</h2>
            <p className={styles.sectionLede}>
              The engine loads a committed rule pack, evaluates a subject against it, and reports
              exactly what it could and could not conclude. No rule is applied without the authority
              behind it traveling with the result.
            </p>

            <div className={styles.grid}>
              {CAPABILITIES.map((f) => (
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
        <section className={`${styles.section} ${styles.sectionBand}`}>
          <div className={styles.container}>
            <div className={styles.callout}>
              <p className={styles.eyebrow}>
                <AlertIcon size={14} />
                The distinction that matters
              </p>
              <h3 className={styles.calloutTitle}>
                Missing data produces INDETERMINATE — never a manufactured PASS.
              </h3>
              <p className={styles.sectionLede}>
                An agency should never be told it is compliant on the strength of data that never
                arrived. When evidence is absent, the system reports it plainly and treats it as
                unresolved — so a green result is always something you can defend.
              </p>
            </div>
          </div>
        </section>

        {/* Safeguards */}
        <section id="safeguards" className={styles.section}>
          <div className={`${styles.container} ${styles.split}`}>
            <div>
              <p className={styles.eyebrow}>Data protection &amp; access</p>
              <h2 className={styles.sectionTitle}>Access is explicit. Hierarchy is not permission.</h2>
              <p className={styles.sectionLede}>
                A state agency positioned above a district does not automatically see that
                district’s student-level data. Every scope grants access to exactly the organization
                it names — an invariant enforced in code, not merely by policy.
              </p>
              <ul className={styles.checkList}>
                <li>
                  <ShieldIcon size={20} />
                  <span>
                    <strong>Per-entity scopes.</strong> Access is granted one organization at a
                    time; parent agencies never inherit a child agency’s data.
                  </span>
                </li>
                <li>
                  <LockIcon size={20} />
                  <span>
                    <strong>Tenant isolation.</strong> Every record is bound to a tenant and an
                    organization; nothing resolves across that boundary.
                  </span>
                </li>
                <li>
                  <CheckIcon size={20} />
                  <span>
                    <strong>Auditable by design.</strong> Determinations, authorities, and pack
                    versions travel together, ready to hand to a monitor.
                  </span>
                </li>
              </ul>
            </div>

            <div className={styles.specPanel} aria-label="System safeguards">
              <div className={styles.specHead}>
                <ServerIcon size={20} />
                System safeguards
              </div>
              <div className={styles.specRow}>
                <span className={styles.specLabel}>Student data confidentiality</span>
                <span className={styles.specValue}>FERPA-aligned</span>
              </div>
              <div className={styles.specRow}>
                <span className={styles.specLabel}>Accessibility conformance</span>
                <span className={styles.specValue}>WCAG 2.1 AA · §508</span>
              </div>
              <div className={styles.specRow}>
                <span className={styles.specLabel}>Tenant &amp; organization isolation</span>
                <span className={`${styles.specValue} ${styles.ok}`}>Enforced</span>
              </div>
              <div className={styles.specRow}>
                <span className={styles.specLabel}>Determination audit trail</span>
                <span className={`${styles.specValue} ${styles.ok}`}>Retained</span>
              </div>
              <div className={styles.specRow}>
                <span className={styles.specLabel}>Rule-pack legal review</span>
                <span className={styles.specValue}>Required pre-release</span>
              </div>
            </div>
          </div>
        </section>

        {/* Audience */}
        <section className={`${styles.section} ${styles.sectionBand}`}>
          <div className={styles.container}>
            <p className={styles.eyebrow}>Who it serves</p>
            <h2 className={styles.sectionTitle}>Built for every level of education oversight.</h2>
            <p className={styles.sectionLede}>
              From a single program to a statewide rollout, the same versioned rule packs and honest
              determinations apply — scoped to what each agency is responsible for.
            </p>

            <div className={styles.audience}>
              {AUDIENCE.map((a) => (
                <article className={styles.audienceCard} key={a.tier}>
                  <div className={styles.cardIcon}>{a.icon}</div>
                  <p className={styles.audienceTier}>{a.tier}</p>
                  <h3>{a.title}</h3>
                  <p>{a.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Coverage */}
        <section id="coverage" className={styles.section}>
          <div className={styles.container}>
            <p className={styles.eyebrow}>Program coverage</p>
            <h2 className={styles.sectionTitle}>Federal packs today, more layers on the way.</h2>
            <p className={styles.sectionLede}>
              We begin where audit risk is highest and expand outward. Each pack undergoes legal
              review before its rules leave the registry.
            </p>

            <div className={styles.tableWrap}>
              <table className={styles.covTable}>
                <thead>
                  <tr>
                    <th scope="col">Program</th>
                    <th scope="col">Authority</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {COVERAGE.map((c) => (
                    <tr key={c.name}>
                      <td className={styles.covProgram}>{c.name}</td>
                      <td className={styles.covAuthority}>{c.authority}</td>
                      <td>
                        <span className={c.live ? styles.badgeLive : styles.badgeSoon}>
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

        {/* Deployment tiers */}
        <section id="deployment" className={`${styles.section} ${styles.sectionBand}`}>
          <div className={styles.container}>
            <p className={styles.eyebrow}>Deployment</p>
            <h2 className={styles.sectionTitle}>Scoped to the oversight you carry.</h2>
            <p className={styles.sectionLede}>
              Every engagement is sized to the number of entities you monitor and the regulatory
              layers you need. We scope it with you — no per-seat surprises.
            </p>

            <div className={styles.pricing}>
              {TIERS.map((p) => (
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
              <h2 className={styles.ctaTitle}>See a determination you could hand to a monitor.</h2>
              <p className={styles.ctaSub}>
                Bring a program you oversee and we will walk it through the IDEA Part B rule pack
                live — citations, statuses, and audit trail included.
              </p>
              <div className={styles.ctaActions}>
                <a
                  className={`${styles.btn} ${styles.btnOnDark} ${styles.btnLg}`}
                  href="mailto:contact@complianceos.edu"
                >
                  Request a demonstration
                </a>
                <Link
                  className={`${styles.btn} ${styles.btnGhostDark} ${styles.btnLg}`}
                  href="/registry"
                >
                  Explore the rule registry
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.container}>
          <div className={styles.footerTop}>
            <div className={styles.footerBrand}>
              <span className={styles.brandName}>
                ComplianceOS <span>EDU</span>
              </span>
              <p>
                Compliance assurance for publicly funded education programs. Versioned rule packs,
                cited authorities, and honest determinations for agencies at every level.
              </p>
            </div>
            <div className={styles.footerCol}>
              <h4>Platform</h4>
              <ul>
                <li>
                  <a href="#mandate">The mandate</a>
                </li>
                <li>
                  <a href="#safeguards">Data protection</a>
                </li>
                <li>
                  <a href="#coverage">Program coverage</a>
                </li>
                <li>
                  <Link href="/registry">Rule registry</Link>
                </li>
              </ul>
            </div>
            <div className={styles.footerCol}>
              <h4>Engage</h4>
              <ul>
                <li>
                  <a href="#deployment">Deployment tiers</a>
                </li>
                <li>
                  <a href="#contact">Request access</a>
                </li>
                <li>
                  <a href="mailto:contact@complianceos.edu">contact@complianceos.edu</a>
                </li>
              </ul>
            </div>
          </div>
          <div className={styles.footerLegal}>
            <p>
              Phase 0 baseline. Rule packs are pending legal review prior to evaluation; nothing on
              this site constitutes legal advice or a compliance determination.
            </p>
            <div className={styles.footerBadges}>
              <span className={styles.footerBadge}>FERPA-aligned</span>
              <span className={styles.footerBadge}>WCAG 2.1 AA</span>
              <span className={styles.footerBadge}>Section 508</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
