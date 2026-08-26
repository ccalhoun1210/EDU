'use client';

import { useId, useMemo, useState } from 'react';
import styles from '@/app/pricing.module.css';
import {
  ALLOCATION_PER_CHILD,
  computePricing,
  formatPct,
  formatRate,
  formatUSD,
} from '@/lib/pricing';

const PRESETS = [150, 400, 1000, 3000];

export function PriceCalculator() {
  const inputId = useId();
  const [raw, setRaw] = useState('400');

  const children = Math.max(0, Math.min(100000, Number.parseInt(raw || '0', 10) || 0));
  const result = useMemo(() => computePricing(children), [children]);

  return (
    <div className={styles.calc}>
      <div className={styles.calcInputRow}>
        <label className={styles.calcLabel} htmlFor={inputId}>
          Children with disabilities served
          <span className={styles.calcLabelHint}>
            Your annual IDEA child count — the same number the product ingests.
          </span>
        </label>

        <div className={styles.calcField}>
          <input
            id={inputId}
            className={styles.calcInput}
            inputMode="numeric"
            pattern="[0-9]*"
            value={raw}
            onChange={(e) => setRaw(e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
            aria-describedby={`${inputId}-desc`}
          />
          <div className={styles.presets} role="group" aria-label="Example district sizes">
            {PRESETS.map((n) => (
              <button
                key={n}
                type="button"
                className={styles.preset}
                aria-pressed={children === n}
                onClick={() => setRaw(String(n))}
              >
                {n.toLocaleString('en-US')}
              </button>
            ))}
          </div>
        </div>
        <p id={`${inputId}-desc`} className={styles.srOnly}>
          Enter the number of children with disabilities your district serves to estimate the IDEA
          Part B grant at risk and the annual price.
        </p>
      </div>

      <div className={styles.calcResults}>
        <div className={styles.resultCard}>
          <span className={styles.resultLabel}>Your IDEA Part B grant at risk</span>
          <span className={styles.resultValue}>{formatUSD(result.allocation)}</span>
          <span className={styles.resultFoot}>
            ≈ {formatUSD(ALLOCATION_PER_CHILD)} per child served (modeled)
          </span>
        </div>

        <div className={`${styles.resultCard} ${styles.resultCardPrimary}`}>
          <span className={styles.resultLabel}>Your annual price</span>
          <span className={styles.resultValue}>{formatUSD(result.annualPrice)}</span>
          <span className={styles.resultFoot}>
            {result.allocation > 0 ? (
              <>
                {formatPct(result.pctOfGrant)} of the grant
                {result.children > 0 && <> · {formatUSD(result.perChild)} per child</>}
              </>
            ) : (
              'Enter a child count above'
            )}
          </span>
        </div>
      </div>

      {/* Show the arithmetic — the pricing page as a demo of the product principle. */}
      <details className={styles.work} open>
        <summary className={styles.workSummary}>How this is calculated</summary>
        <div className={styles.workBody}>
          <p className={styles.workIntro}>
            The price is charged in marginal bands against the allocation, like tax brackets. Each
            band of the grant is charged at a declining rate, so the price always rises with size
            while the effective rate always falls.
          </p>

          <table className={styles.workTable}>
            <thead>
              <tr>
                <th scope="col">Band of allocation</th>
                <th scope="col">Rate</th>
                <th scope="col">Amount in band</th>
                <th scope="col" className={styles.num}>
                  Charge
                </th>
              </tr>
            </thead>
            <tbody>
              {result.breakdown.map((c, i) => (
                <tr key={i}>
                  <td>
                    {formatUSD(c.band.from)} – {c.band.to === null ? 'above' : formatUSD(c.band.to)}
                  </td>
                  <td>{formatRate(c.band.rate)}</td>
                  <td>{formatUSD(c.portion)}</td>
                  <td className={styles.num}>{formatUSD(c.amount)}</td>
                </tr>
              ))}
              {result.breakdown.length === 0 && (
                <tr>
                  <td colSpan={4} className={styles.workEmpty}>
                    Enter a child count to see the band breakdown.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={3}>
                  Sum of bands
                </th>
                <td className={styles.num}>{formatUSD(Math.round(result.rawPrice))}</td>
              </tr>
              {result.atFloor && (
                <tr>
                  <th scope="row" colSpan={3}>
                    Annual floor applied
                  </th>
                  <td className={styles.num}>{formatUSD(9000)}</td>
                </tr>
              )}
              <tr className={styles.workTotal}>
                <th scope="row" colSpan={3}>
                  Annual price (rounded to nearest $500)
                </th>
                <td className={styles.num}>{formatUSD(result.annualPrice)}</td>
              </tr>
            </tfoot>
          </table>

          {result.atFloor && (
            <p className={styles.floorNote}>
              At this size the {formatUSD(9000)} floor is {formatPct(result.pctOfGrant)} of the
              grant. That is not a price a small district should pay directly — reach this product
              through your <a href="#esa">educational service agency</a> instead.
            </p>
          )}
        </div>
      </details>

      <p className={styles.calcDisclaimer}>
        Estimate only. The {formatUSD(ALLOCATION_PER_CHILD)}-per-child figure assumes an
        illustrative 15% SEA set-aside; a real quote uses your state&apos;s published allocation
        table. Prices are for the fiscal module, which every district receives in full.
      </p>
    </div>
  );
}
