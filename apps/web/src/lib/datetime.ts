import type { Lang } from './i18n';

const BANGKOK = 'Asia/Bangkok';

/**
 * Asia/Bangkok date and time of an instant, Buddhist-era year for Thai,
 * Gregorian for English: `วันที่ 12/10/2569 เวลา 23:00 น.` / `12/10/2026 23:00`.
 * Same shape as the certificate's submission timestamp.
 */
export function formatBangkokDateTime(value: string | Date, lang: Lang): string {
	const date = typeof value === 'string' ? new Date(value) : value;
	const parts = new Intl.DateTimeFormat('en-GB', {
		timeZone: BANGKOK,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
	}).formatToParts(date);
	const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
	const year = Number(get('year'));
	if (lang === 'th') {
		return `วันที่ ${get('day')}/${get('month')}/${year + 543} เวลา ${get('hour')}:${get('minute')} น.`;
	}
	return `${get('day')}/${get('month')}/${year} ${get('hour')}:${get('minute')}`;
}

/**
 * Asia/Bangkok calendar date only: `12/10/2569` for Thai (Buddhist era),
 * `12/10/2026` for English.
 */
export function formatBangkokDate(value: string | Date, lang: Lang): string {
	const date = typeof value === 'string' ? new Date(value) : value;
	const parts = new Intl.DateTimeFormat('en-GB', {
		timeZone: BANGKOK,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).formatToParts(date);
	const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
	const year = Number(get('year'));
	return `${get('day')}/${get('month')}/${lang === 'th' ? year + 543 : year}`;
}

/** Current Gregorian year in Asia/Bangkok (not the browser's timezone). */
export function bangkokYear(date: Date = new Date()): number {
	return Number(
		new Intl.DateTimeFormat('en-GB', { timeZone: BANGKOK, year: 'numeric' }).format(date),
	);
}
