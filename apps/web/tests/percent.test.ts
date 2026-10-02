import { describe, expect, test } from 'bun:test';
import {
	RATE_HIGH_ABOVE,
	RATE_LOW_BELOW,
	displayPercent,
	exactPercent,
	formatPercent,
	rateTier,
} from '../src/lib/percent';

describe('formatPercent', () => {
	test('zero and empty scope', () => {
		expect(formatPercent(0, 569)).toBe('0%');
		expect(formatPercent(0, 0)).toBe('0%');
		expect(formatPercent(5, 0)).toBe('0%');
	});

	test('tiny non-zero shares keep one decimal and are never 0%', () => {
		expect(formatPercent(2, 569)).toBe('0.4%'); // 0.3515 -> 0.4
		expect(formatPercent(1, 569)).toBe('0.2%');
		expect(formatPercent(1, 100000)).toBe('0.1%'); // floor at 0.1 instead of 0
		expect(formatPercent(5, 569)).toBe('0.9%'); // 0.879
		for (let n = 1; n <= 2000; n++) {
			expect(displayPercent(1, n)).toBeGreaterThan(0);
		}
	});

	test('at or above 1% is a whole number', () => {
		expect(formatPercent(6, 569)).toBe('1%'); // 1.054
		expect(formatPercent(1, 3)).toBe('33%');
		expect(formatPercent(30, 100)).toBe('30%');
		expect(formatPercent(1, 2)).toBe('50%');
	});

	test('never 100% while someone is missing, always 100% when all are in', () => {
		expect(formatPercent(568, 569)).toBe('99%');
		expect(formatPercent(199, 200)).toBe('99%'); // 99.5 rounds up to 100, clamped
		expect(formatPercent(9999, 10000)).toBe('99%');
		expect(formatPercent(569, 569)).toBe('100%');
		expect(formatPercent(7, 7)).toBe('100%');
	});

	test('a value above the total (bad data) does not exceed 100%', () => {
		expect(formatPercent(12, 10)).toBe('100%');
	});

	test('display number is the bar width: strictly between 0 and 100 unless empty/full', () => {
		for (let total = 1; total <= 400; total++) {
			for (let v = 0; v <= total; v++) {
				const p = displayPercent(v, total);
				if (v === 0) expect(p).toBe(0);
				else if (v === total) expect(p).toBe(100);
				else {
					expect(p).toBeGreaterThan(0);
					expect(p).toBeLessThan(100);
				}
			}
		}
	});
});

describe('rateTier', () => {
	test('thresholds are single constants: <30 low, 30..70 mid, >70 high', () => {
		expect(RATE_LOW_BELOW).toBe(30);
		expect(RATE_HIGH_ABOVE).toBe(70);
		expect(rateTier(29, 100)).toBe('low');
		expect(rateTier(30, 100)).toBe('mid');
		expect(rateTier(70, 100)).toBe('mid');
		expect(rateTier(71, 100)).toBe('high');
		expect(rateTier(100, 100)).toBe('high');
		expect(rateTier(0, 100)).toBe('low');
	});

	test('uses the exact share, not the rounded one', () => {
		// 299/1000 = 29.9% would display as 30% but is still "low"
		expect(formatPercent(299, 1000)).toBe('30%');
		expect(rateTier(299, 1000)).toBe('low');
		// 700/1000 = exactly 70% stays mid; 701/1000 is high
		expect(rateTier(700, 1000)).toBe('mid');
		expect(rateTier(701, 1000)).toBe('high');
		expect(exactPercent(1, 3)).toBeCloseTo(33.333, 2);
	});

	test('empty scope is low', () => {
		expect(rateTier(0, 0)).toBe('low');
	});
});
