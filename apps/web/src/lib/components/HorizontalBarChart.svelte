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
	import { ChevronRight } from 'lucide-svelte';

	interface Props {
		items: BarItem[];
		/** Text shown under each bar, e.g. "ยื่นแล้ว 3 / ทั้งหมด 10 (30%)". */
		valueText: (item: BarItem, percent: number) => string;
		ariaLabel: string;
		onselect?: (key: string) => void;
	}

	let { items, valueText, ariaLabel, onselect }: Props = $props();

	function percentOf(item: BarItem): number {
		return item.total > 0 ? Math.round((item.value / item.total) * 100) : 0;
	}
</script>

<ul class="space-y-2.5" aria-label={ariaLabel}>
	{#each items as item (item.key)}
		{@const pct = percentOf(item)}
		<li>
			<button
				type="button"
				onclick={() => onselect?.(item.key)}
				disabled={!onselect}
				aria-label={`${item.label}: ${valueText(item, pct)}`}
				class="group block w-full rounded-card border border-ink-100 bg-surface p-4 text-left shadow-soft transition enabled:hover:border-brand-300 enabled:hover:shadow-lift "
			>
				<div class="flex items-start justify-between gap-3">
					<span class="min-w-0 break-words font-semibold text-ink-900">{item.label}</span>
					{#if onselect}
						<ChevronRight
							size={18}
							class="mt-0.5 shrink-0 text-ink-400 transition group-hover:text-brand-600"
						/>
					{/if}
				</div>
				<div
					class="mt-2.5 h-3 w-full overflow-hidden rounded-full bg-bar-track"
					role="presentation"
				>
					<div
						class="h-full rounded-full bg-bar-fill transition-[width]"
						style:width="{pct}%"
					></div>
				</div>
				<div class="mt-2 text-sm text-ink-600">{valueText(item, pct)}</div>
			</button>
		</li>
	{/each}
</ul>
