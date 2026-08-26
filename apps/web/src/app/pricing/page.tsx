import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/marketing/site-header';
import { PriceCalculator } from '@/components/marketing/price-calculator';
import {
  ArrowRightIcon,
  CheckIcon,
  FileCheckIcon,
  ShieldIcon,
} from '@/components/marketing/icons';
import sales from '@/app/sales.module.css';
import styles from '@/app/pricing.module.css';
import {
  BANDS,
  computePricing,
  formatRate,
  formatUSD,
  formatPct,
  REPRESENTATIVE_ROWS,
} from '@/lib/pricing';

export const metadata: Metadata = {
  title: 'Pricing — ComplianceOS EDU',
  description:
    'Priced against the IDEA Part B grant it protects, in published marginal bands. Enter your child count and see the price and the arithmetic — no quote required.',
};

const included = [
  {
    title: 'Every statutory MOE method',
    desc: 'All four maintenance-of-effort tests, run on your own child count and expenditure data.',
  },
  {
    title: 'Excess-cost and proportionate-share checks',
    desc: 'The full fiscal rule set, with citations to the controlling regulation on every result.',
  },
  {
    title: 'Versioned, citable rule packs',
    desc: 'Every determination pinned to a rule-pack version you can reproduce and defend later.',
  },
  {
    title: 'Honest determinations',
    desc: 'Missing data returns INDETERMINATE, never a manufactured PASS. No result is gated by price.',
  },
];

const channels = [
  {
    who: 'District',
    title: 'Direct',
    icon: FileCheckIcon,
    body: '250+ children served. The published band table, signed by the district. Fiscal-year aligned.',
  },
  {
    who: 'Service agency',
    title: 'ESA / co-op',
    icon: ShieldIcon,
    body: 'One contract covering member districts at a per-member rate below the floor. The ESA administers it — the standing structure small and rural districts already use.',
  },
  {
    who: 'State agency',
    title: 'SEA',
    icon: ShieldIcon,
    body: 'A different product: monitoring across every LEA in the state, priced against state-level activity funds — not a district budget.',
  },
];

const facts = [
  { term: 'Fiscal-year alignment', desc: 'Contracts align to your fiscal year so the price fits a budget line built months ahead.' },
  { term: 'Vendor onboarding', desc: 'W-9, vendor registration, and standard procurement paperwork on request.' },
  { term: 'Cooperative contracts', desc: 'Available through cooperative purchasing vehicles where your agency already buys.' },
  { term: 'Data privacy agreement', desc: 'FERPA-aligned DPA executed before any student-level data is processed.' },
  { term: 'Accessibility report', desc: 'A WCAG 2.1 AA / Section 508 conformance report (ACR) provided for review.' },
  { term: 'Multi-year terms', desc: 'Annual or multi-year available; multi-year can be discounted for budget stability.' },
];

const roadmap = ['Evidence vault', 'Programmatic SPED monitoring', 'Disproportionality analysis'];

export default function PricingPage() {
  const heroExample = computePricing(400);

  return (
    <div className={sales.page}>
      <SiteHeader />

      <main id="main">
        {/* ---------- Hero + calculator ---------- */}
        <section className={styles.hero}>
          <div className={sales.container}>
            <div className={styles.heroInner}>
              <div className={styles.heroCopy}>
                <span className={sales.kicker}>Pricing</span>
                <h1 className={styles.heroTitle}>
                  Priced against the grant it protects — and we publish the number.
                </h1>
                <p className={styles.heroLede}>
                  Every incumbent hides behind &ldquo;request a quote,&rdquo; which
                  skips the budget cycle and costs a year. Enter your child count
                  and see both the exposure and the price, with the arithmetic shown.
                </p>
              </div>
              <PriceCalculator />
            </div>
          </div>
        </section>

        {/* ---------- Published band table ---------- */}
        <section id="bands" className={`${sales.section} ${sales.sectionAlt}`}>
          <div className={sales.container}>
            <span className={sales.kicker}>The model</span>
            <h2 className={sales.sectionTitle}>Marginal bands on the allocation</h2>
            <p className={sales.sectionLede}>
              Each band of your IDEA Part B allocation is charged at a declining
              rate, the way tax brackets work. This guarantees the price always
              rises with size while the effective rate always falls — no
              tier-boundary inversions, verified computationally.
            </p>

            <ul className={styles.bandRates}>
              {BANDS.map((b, i) => (
                <li key={i}>
                  <strong>{formatRate(b.rate)}</strong> ·{' '}
                  {b.to === null
                    ? `above ${formatUSD(b.from)}`
                    : `${formatUSD(b.from)} – ${formatUSD(b.to)}`}
                </li>
              ))}
              <li>
                <strong>{formatUSD(9000)}</strong> · annual floor
              </li>
            </ul>

            <div className={styles.bandTableWrap} style={{ marginTop: '1.5rem' }}>
              <table className={styles.bandTable}>
                <thead>
                  <tr>
                    <th scope="col">Children served</th>
                    <th scope="col">IDEA grant ≈</th>
                    <th scope="col">Annual price</th>
                    <th scope="col">% of grant</th>
                    <th scope="col">Per child</th>
                    <th scope="col">Channel</th>
                  </tr>
                </thead>
                <tbody>
                  {REPRESENTATIVE_ROWS.map((n) => {
                    const r = computePricing(n);
                    const channelLabel =
                      r.channel === 'esa'
                        ? 'ESA / co-op'
                        : r.channel === 'direct-custom'
                          ? 'Direct, custom'
                          : 'Direct';
                    return (
                      <tr key={n}>
                        <td>{n.toLocaleString('en-US')}</td>
                        <td>{formatUSD(r.allocation)}</td>
                        <td>{formatUSD(r.annualPrice)}</td>
                        <td>{formatPct(r.pctOfGrant)}</td>
                        <td>{formatUSD(r.perChild)}</td>
                        <td>
                          <span
                            className={`${styles.channelPill} ${
                              r.channel === 'esa' ? '' : styles.channelDirect
                            }`}
                          >
                            {channelLabel}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ---------- What's included ---------- */}
        <section id="included" className={sales.section}>
          <div className={sales.container}>
            <span className={sales.kicker}>What&apos;s included</span>
            <h2 className={sales.sectionTitle}>Every district gets the whole fiscal module</h2>
            <p className={sales.sectionLede}>
              No feature gating by tier. Gating a statutory compliance check
              behind a price tier is indefensible when the check is the law —
              so we don&apos;t. The price scales with the grant; the product does not.
            </p>
            <ul className={styles.includedGrid}>
              {included.map((item) => (
                <li key={item.title} className={styles.includedItem}>
                  <CheckIcon size={20} />
                  <span>
                    <strong>{item.title}</strong>
                    <span>{item.desc}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---------- How districts pay ---------- */}
        <section id="funding" className={`${sales.section} ${sales.sectionAlt}`}>
          <div className={sales.container}>
            <span className={sales.kicker}>How districts pay for it</span>
            <h2 className={sales.sectionTitle}>
              The first question is which pot of money pays
            </h2>
            <p className={sales.sectionLede} style={{ marginBottom: '1.5rem' }}>
              Getting this right matters more than the number, and the honest
              position is to work it through with you — not to assert an answer
              that isn&apos;t settled.
            </p>
            <div className={styles.callout}>
              <h3>What we will and won&apos;t claim</h3>
              <p>
                Part B funds must be used for the <em>excess costs</em> of special
                education and must supplement, not supplant (<code>34 CFR 300.202</code>).
                Permissive use covers technology for IEP <em>case-management</em>{' '}
                recordkeeping (<code>34 CFR 300.208(c)</code>) — a plausible fit for
                the programmatic module later, a stretch for the fiscal module today.
              </p>
              <p>
                The likely path for the fiscal module is as an administrative cost
                allocable under <code>2 CFR Part 200</code>. That has not been
                confirmed, so we won&apos;t assert it. Bring your federal-programs
                director and your SEA fiscal contact into the first call and
                we&apos;ll work the funding source through together.
              </p>
            </div>
          </div>
        </section>

        {/* ---------- Channels ---------- */}
        <section id="esa" className={sales.section}>
          <div className={sales.container}>
            <span className={sales.kicker}>Not every district buys direct</span>
            <h2 className={sales.sectionTitle}>Three routes, matched to who you are</h2>
            <p className={sales.sectionLede}>
              At 75–150 children served the floor is a large share of the grant —
              not a price a small district should pay directly. Roughly a third of
              districts serve under 600 students; they buy through the service
              agencies that already administer their special-education compliance.
            </p>
            <div className={styles.channelGrid}>
              {channels.map((c) => {
                const Icon = c.icon;
                return (
                  <div key={c.title} className={styles.channelCard}>
                    <span className={styles.channelWho}>{c.who}</span>
                    <span className={styles.channelCardHead}>
                      <Icon size={20} />
                      {c.title}
                    </span>
                    <p>{c.body}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ---------- Procurement facts ---------- */}
        <section id="procurement" className={`${sales.section} ${sales.sectionAlt}`}>
          <div className={sales.container}>
            <span className={sales.kicker}>Procurement</span>
            <h2 className={sales.sectionTitle}>The facts your business office needs</h2>
            <div className={styles.factsGrid}>
              {facts.map((f) => (
                <div key={f.term} className={styles.fact}>
                  <span className={styles.factTerm}>{f.term}</span>
                  <span className={styles.factDesc}>{f.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- Roadmap, named not priced ---------- */}
        <section id="roadmap" className={sales.section}>
          <div className={sales.container}>
            <span className={sales.kicker}>Roadmap</span>
            <h2 className={sales.sectionTitle}>Named, not sold</h2>
            <p className={styles.roadmapNote}>
              These are on the roadmap, not SKUs. We won&apos;t price a module that
              doesn&apos;t exist or grey out a &ldquo;coming soon&rdquo; tier — the
              price above is for the fiscal module you can use today.
            </p>
            <ul className={styles.roadmapList}>
              {roadmap.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---------- CTA ---------- */}
        <section id="contact" className={`${sales.section} ${sales.sectionAlt}`}>
          <div className={sales.container}>
            <span className={sales.kicker}>Next step</span>
            <h2 className={sales.sectionTitle}>
              Put {formatUSD(heroExample.annualPrice)} in a budget line, or talk it through
            </h2>
            <p className={sales.sectionLede} style={{ marginBottom: '1.5rem' }}>
              You have a defensible number for next year&apos;s budget request
              already. When you&apos;re ready, we&apos;ll quote against your
              state&apos;s actual allocation table and work through the funding source.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
              <a className={`${sales.btn} ${sales.btnPrimary} ${sales.btnLg}`} href="mailto:hello@complianceos.example?subject=ComplianceOS%20EDU%20demo">
                Request a demo
                <ArrowRightIcon size={18} />
              </a>
              <a className={`${sales.btn} ${sales.btnGhost} ${sales.btnLg}`} href="mailto:hello@complianceos.example?subject=Pricing%20for%20my%20state">
                Talk to us about your state
              </a>
            </div>
            <p style={{ marginTop: '1.5rem', fontSize: '0.9rem' }}>
              <Link href="/">← Back to overview</Link>
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
