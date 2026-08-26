/**
 * ComplianceOS EDU — fiscal-module pricing model.
 *
 * Pricing is charged against the district's IDEA Part B allocation using
 * MARGINAL BANDS (like tax brackets), which guarantees the price rises
 * monotonically with size while the effective rate falls. See the pricing
 * memo (2026-08-25) for the derivation and the statutory basis.
 *
 * Every number the UI shows comes from here so the page can "show its work"
 * the same way the product does — no black box.
 */

/** Modeled federal Part B dollars per child served, net of an illustrative
 *  15% SEA state-level set-aside. This is a MODELING ASSUMPTION, not a fact;
 *  quote the real state allocation table for a real district. */
export const ALLOCATION_PER_CHILD = 1600;

/** Annual floor. Below this, direct sale is uneconomic — route to an ESA. */
export const ANNUAL_FLOOR = 9000;

/** Round to the nearest $500, as published. */
const ROUND_TO = 500;

export interface Band {
  /** Lower bound of this band of the allocation (inclusive). */
  from: number;
  /** Upper bound (exclusive). `null` means "and above". */
  to: number | null;
  /** Marginal rate applied to the portion of the allocation in this band. */
  rate: number;
}

export const BANDS: Band[] = [
  { from: 0, to: 500_000, rate: 0.025 },
  { from: 500_000, to: 2_000_000, rate: 0.015 },
  { from: 2_000_000, to: 5_000_000, rate: 0.009 },
  { from: 5_000_000, to: null, rate: 0.005 },
];

export interface BandContribution {
  band: Band;
  /** Portion of the allocation that fell inside this band. */
  portion: number;
  /** Dollar contribution from this band (portion × rate). */
  amount: number;
}

export type Channel = 'esa' | 'direct' | 'direct-custom';

export interface PricingResult {
  children: number;
  /** IDEA Part B allocation ≈ the grant at risk. */
  allocation: number;
  /** Sum of band contributions, before the floor and before rounding. */
  rawPrice: number;
  /** Whether the annual floor is the binding price. */
  atFloor: boolean;
  /** Final published annual price (floor applied, rounded to $500). */
  annualPrice: number;
  /** annualPrice / allocation. */
  pctOfGrant: number;
  /** annualPrice / children. */
  perChild: number;
  /** Per-band breakdown, for the "show the arithmetic" panel. */
  breakdown: BandContribution[];
  /** Recommended purchasing channel for a district this size. */
  channel: Channel;
}

function roundToNearest(value: number, step: number): number {
  return Math.round(value / step) * step;
}

export function allocationForChildren(children: number): number {
  return Math.max(0, Math.round(children)) * ALLOCATION_PER_CHILD;
}

function bandBreakdown(allocation: number): BandContribution[] {
  return BANDS.map((band) => {
    const upper = band.to ?? Infinity;
    const portion = Math.max(0, Math.min(allocation, upper) - band.from);
    return { band, portion, amount: portion * band.rate };
  }).filter((c) => c.portion > 0);
}

function channelForChildren(children: number): Channel {
  if (children < 250) return 'esa';
  if (children < 3000) return 'direct';
  return 'direct-custom';
}

/** Compute the full pricing result for a number of children served. */
export function computePricing(childrenInput: number): PricingResult {
  const children = Math.max(0, Math.round(childrenInput || 0));
  const allocation = allocationForChildren(children);
  const breakdown = bandBreakdown(allocation);
  const rawPrice = breakdown.reduce((sum, c) => sum + c.amount, 0);

  const atFloor = rawPrice <= ANNUAL_FLOOR;
  const annualPrice = roundToNearest(Math.max(rawPrice, ANNUAL_FLOOR), ROUND_TO);

  return {
    children,
    allocation,
    rawPrice,
    atFloor,
    annualPrice,
    pctOfGrant: allocation > 0 ? annualPrice / allocation : 0,
    perChild: children > 0 ? annualPrice / children : 0,
    breakdown,
    channel: channelForChildren(children),
  };
}

/* ---------------- formatting helpers ---------------- */

export function formatUSD(value: number, opts: { cents?: boolean } = {}): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : 0,
  }).format(value);
}

export function formatPct(fraction: number): string {
  return `${(fraction * 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

export function formatRate(rate: number): string {
  return `${(rate * 100).toLocaleString('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

/** Representative rows for the published band table (matches the memo). */
export const REPRESENTATIVE_ROWS: number[] = [
  75, 150, 250, 400, 500, 750, 1000, 1500, 2000, 3000, 5000, 8000, 15000,
];
