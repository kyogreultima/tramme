// What each plan gives, as data the platform reads: the price of a period, the
// credits that come with it, and what the account may do. The pricing page
// (apps/site/src/lib/plans.ts) shows the same figures; the words around them are
// the site's, the numbers are these. Paid features are services the platform
// runs, not switches in the app's code.

export type PlanId = 'basic' | 'plus' | 'pro';
export type PaidPlanId = Exclude<PlanId, 'basic'>;
export type Interval = 'month' | 'year';

export interface PlanTerms {
  id: PlanId;
  /** euros a month; `year` is the monthly price when billed yearly */
  price: { month: number; year: number };
  /** credits granted at the start of each paid period */
  credits: number;
  /** whether credits left at the end of a period carry over (open decision: they lapse for now) */
  rollover: boolean;
  /** projects kept in the cloud (null: no limit) */
  cloudProjects: number | null;
  privateProjects: boolean;
  /** days of version history (null: all of it) */
  historyDays: number | null;
  /** the Tramme logo in a corner of the cloud exports: always, or by default and removable */
  watermark: 'always' | 'optional';
  export4k: boolean;
  priorityQueue: boolean;
}

export const PLAN_TERMS: readonly PlanTerms[] = [
  { id: 'basic', price: { month: 0, year: 0 }, credits: 0, rollover: false, cloudProjects: 3, privateProjects: false, historyDays: 7, watermark: 'always', export4k: false, priorityQueue: false },
  { id: 'plus', price: { month: 12, year: 10 }, credits: 1000, rollover: false, cloudProjects: null, privateProjects: true, historyDays: 30, watermark: 'optional', export4k: false, priorityQueue: false },
  { id: 'pro', price: { month: 35, year: 29 }, credits: 4000, rollover: false, cloudProjects: null, privateProjects: true, historyDays: null, watermark: 'optional', export4k: true, priorityQueue: true },
];

export const termsOf = (id: PlanId): PlanTerms => PLAN_TERMS.find((p) => p.id === id)!;
export const isPaid = (id: unknown): id is PaidPlanId => id === 'plus' || id === 'pro';
export const isInterval = (x: unknown): x is Interval => x === 'month' || x === 'year';

/** what one period costs, in euros: a month, or twelve months at the yearly monthly price */
export const amountDue = (id: PaidPlanId, interval: Interval): number => (interval === 'year' ? termsOf(id).price.year * 12 : termsOf(id).price.month);
