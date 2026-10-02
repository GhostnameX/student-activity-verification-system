/**
 * The one place that turns "value of total" into a percentage for display.
 *
 * Rules (round-2 follow-up):
 *  - 0 of n shows 0%; nobody in scope (total 0) shows 0%.
 *  - Anything above 0 but below 1% keeps one decimal (2/569 -> 0.4%), never "0%".
 *  - 100% only when everyone is in; rounding can never reach 100 while someone is still missing
 *    (568/569 -> 99%).
 *  - Everything else is rounded to a whole number.
 * Works on counts, not on a pre-divided rate, so there is no float round-trip.
 */

/** Below this share (in %) a group/major is shown as "low" (red). */
export const RATE_LOW_BELOW = 30;
/** Above this share (in %) a group/major is shown as "high" (green); in between is "mid" (amber). */
export const RATE_HIGH_ABOVE = 70;

export type RateTier = 'low' | 'mid' | 'high';

/** Exact share in percent (0..100), unrounded. */
export function exactPercent(value: number, total: number): number {
	if (total <= 0 || value <= 0) return 0;
	if (value >= total) return 100;
	return (value / total) * 100;
}

/** The number shown to the user (and used for the bar width): 0, 0.1-0.9, 1-99 or 100. */
export function displayPercent(value: number, total: number): number {
	if (total <= 0 || value <= 0) return 0;
	if (value >= total) return 100;
	const exact = (value / total) * 100;
	if (exact < 1) return Math.max(0.1, Math.round(exact * 10) / 10);
	return Math.min(99, Math.round(exact));
}

/** "0%", "0.4%", "30%", "99%" or "100%". */
export function formatPercent(value: number, total: number): string {
	return `${displayPercent(value, total)}%`;
}

/** Tier from the exact share (not the rounded one), using integer math at the boundaries. */
export function rateTier(value: number, total: number): RateTier {
	if (total <= 0) return 'low';
	const v = Math.max(0, Math.min(value, total));
	if (v * 100 < RATE_LOW_BELOW * total) return 'low';
	if (v * 100 > RATE_HIGH_ABOVE * total) return 'high';
	return 'mid';
}
