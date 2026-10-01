<script lang="ts">
	import type { FileText } from 'lucide-svelte';
	import { ChevronRight } from 'lucide-svelte';

	interface Props {
		label: string;
		value: string | number;
		icon: typeof FileText;
		tone?: 'ink' | 'brand' | 'green' | 'amber' | 'orange' | 'red';
		/** When set the whole card is a button. */
		onclick?: () => void;
		ariaLabel?: string;
	}

	let { label, value, icon: Icon, tone = 'ink', onclick, ariaLabel }: Props = $props();

	const tones = {
		ink: 'from-ink-500 to-ink-700',
		brand: 'from-brand-500 to-brand-700',
		green: 'from-green-600 to-green-700',
		amber: 'from-amber-500 to-amber-700',
		orange: 'from-orange-500 to-orange-700',
		red: 'from-red-600 to-red-700',
	};
	const base =
		'block w-full rounded-card border border-ink-100 bg-surface p-5 text-left shadow-soft transition';
</script>

{#snippet body()}
	<div
		class="mb-3 flex h-10 w-10 items-center justify-center rounded-control bg-gradient-to-br text-white shadow-soft {tones[tone]}"
	>
		<Icon size={19} aria-hidden="true" />
	</div>
	<p class="flex items-center gap-1 text-sm text-ink-500">
		{label}
		{#if onclick}<ChevronRight size={14} class="text-ink-400" aria-hidden="true" />{/if}
	</p>
	<p class="mt-1 text-3xl font-extrabold tracking-tight text-ink-900">{value}</p>
{/snippet}

{#if onclick}
	<button
		type="button"
		{onclick}
		aria-label={ariaLabel ?? `${label}: ${value}`}
		class="{base} cursor-pointer hover:border-brand-300 hover:shadow-lift"
	>
		{@render body()}
	</button>
{:else}
	<div class="{base} hover:shadow-lift">{@render body()}</div>
{/if}
