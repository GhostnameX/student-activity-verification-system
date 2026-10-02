<script lang="ts" module>
	export interface BarItem {
		key: string;
		label: string;
		/** Filled part of the bar (e.g. submitted). */
		value: number;
		/** Whole bar (e.g. everyone in scope). */
		total: number;
	}
</script>

<script lang="ts">
	import { ChevronRight, CircleAlert, CircleCheck, CircleDot } from 'lucide-svelte';
	import { lang } from '$lib/store';
	import { translate } from '$lib/i18n';
	import {
		RATE_HIGH_ABOVE,
		RATE_LOW_BELOW,
		displayPercent,
		rateTier,
		type RateTier,
	} from '$lib/percent';

	interface Props {
		items: BarItem[];
		/** Text shown under each bar, e.g. "ยื่นแล้ว 3 / ทั้งหมด 10 (30%)". */
		valueText: (item: BarItem, percent: number) => string;
		ariaLabel: string;
		onselect?: (key: string) => void;
	}

	let { items, valueText, ariaLabel, onselect }: Props = $props();

	// One shared rule for every percentage on the site: see $lib/percent.
	function percentOf(item: BarItem): number {
		return displayPercent(item.value, item.total);
	}

	// Card tint + bar colour follow the submission rate (thresholds: $lib/percent). The level is
	// always written next to an icon, so colour is never the only signal.
	const tiers: Record<
		RateTier,
		{ card: string; fill: string; track: string; text: string; icon: typeof CircleAlert; label: 'rateLevelLow' | 'rateLevelMid' | 'rateLevelHigh' }
	> = {
		low: {
			card: 'bg-rejected-soft border-rejected-ring',
			fill: 'bg-tier-low-fill',
			track: 'bg-tier-low-track',
			text: 'text-rejected',
			icon: CircleAlert,
			label: 'rateLevelLow',
		},
		mid: {
			card: 'bg-pending-soft border-pending-ring',
			fill: 'bg-tier-mid-fill',
			track: 'bg-tier-mid-track',
			text: 'text-pending',
			icon: CircleDot,
			label: 'rateLevelMid',
		},
		high: {
			card: 'bg-approved-soft border-approved-ring',
			fill: 'bg-tier-high-fill',
			track: 'bg-tier-high-track',
			text: 'text-approved',
			icon: CircleCheck,
			label: 'rateLevelHigh',
		},
	};
</script>

<div class="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-600" aria-label={translate($lang, 'rateLegendTitle')}>
	<span class="font-semibold">{translate($lang, 'rateLegendTitle')}:</span>
	{#each [['low', translate($lang, 'rateLegendLow').replace('{n}', String(RATE_LOW_BELOW))], ['mid', translate($lang, 'rateLegendMid').replace('{a}', String(RATE_LOW_BELOW)).replace('{b}', String(RATE_HIGH_ABOVE))], ['high', translate($lang, 'rateLegendHigh').replace('{n}', String(RATE_HIGH_ABOVE))]] as [tier, range] (tier)}
		{@const t = tiers[tier as RateTier]}
		<span class="inline-flex items-center gap-1.5">
			<span class="h-2.5 w-2.5 rounded-full {t.fill}" aria-hidden="true"></span>
			<span class="font-medium {t.text}">{translate($lang, t.label)}</span>
			<span>({range})</span>
		</span>
	{/each}
</div>

<ul class="space-y-2.5" aria-label={ariaLabel}>
	{#each items as item (item.key)}
		{@const pct = percentOf(item)}
		{@const tier = tiers[rateTier(item.value, item.total)]}
		<li>
			<button
				type="button"
				onclick={() => onselect?.(item.key)}
				disabled={!onselect}
				aria-label={`${item.label}: ${valueText(item, pct)}, ${translate($lang, tier.label)}`}
				class="group block w-full rounded-card border p-4 text-left shadow-soft transition enabled:hover:shadow-lift {tier.card}"
			>
				<div class="flex items-start justify-between gap-3">
					<span class="min-w-0 break-words font-semibold text-ink-900">{item.label}</span>
					<span class="flex shrink-0 items-center gap-2">
						<span class="inline-flex items-center gap-1 text-xs font-bold {tier.text}">
							<tier.icon size={14} aria-hidden="true" />
							{translate($lang, tier.label)}
						</span>
						{#if onselect}
							<ChevronRight
								size={18}
								class="mt-0.5 shrink-0 text-ink-500 transition group-hover:text-ink-900"
								aria-hidden="true"
							/>
						{/if}
					</span>
				</div>
				<div
					class="mt-2.5 h-3 w-full overflow-hidden rounded-full {tier.track}"
					role="presentation"
				>
					<div
						class="h-full rounded-full transition-[width] {tier.fill}"
						style:width="{pct}%"
					></div>
				</div>
				<div class="mt-2 text-sm text-ink-600">{valueText(item, pct)}</div>
			</button>
		</li>
	{/each}
</ul>
