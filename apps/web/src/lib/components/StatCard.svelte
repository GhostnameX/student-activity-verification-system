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

	// Icon chip colour (unchanged) and the card tint. Tint tokens live in app.css (light + dark)
	// so the number and label keep >= 4.5:1 on the soft background in both themes.
	const chips = {
		ink: 'from-ink-500 to-ink-700',
		brand: 'from-brand-500 to-brand-700',
		green: 'from-green-600 to-green-700',
		amber: 'from-amber-500 to-amber-700',
		orange: 'from-orange-500 to-orange-700',
		red: 'from-red-600 to-red-700',
	};
	const tints = {
		ink: 'bg-tone-ink-soft border-tone-ink-ring text-tone-ink-text',
		brand: 'bg-tone-brand-soft border-tone-brand-ring text-tone-brand-text',
		green: 'bg-tone-green-soft border-tone-green-ring text-tone-green-text',
		amber: 'bg-tone-amber-soft border-tone-amber-ring text-tone-amber-text',
		orange: 'bg-tone-orange-soft border-tone-orange-ring text-tone-orange-text',
		red: 'bg-tone-red-soft border-tone-red-ring text-tone-red-text',
	};
	let base = $derived(
		`block w-full rounded-card border p-5 text-left shadow-soft transition ${tints[tone]}`,
	);
</script>

{#snippet body()}
	<div
		class="mb-3 flex h-10 w-10 items-center justify-center rounded-control bg-gradient-to-br text-white shadow-soft {chips[tone]}"
	>
		<Icon size={19} aria-hidden="true" />
	</div>
	<p class="flex items-center gap-1 text-sm font-medium">
		{label}
		{#if onclick}<ChevronRight size={14} aria-hidden="true" />{/if}
	</p>
	<p class="mt-1 text-3xl font-extrabold tracking-tight">{value}</p>
{/snippet}

{#if onclick}
	<button
		type="button"
		{onclick}
		aria-label={ariaLabel ?? `${label}: ${value}`}
		class="{base} cursor-pointer hover:shadow-lift"
	>
		{@render body()}
	</button>
{:else}
	<div class="{base} hover:shadow-lift">{@render body()}</div>
{/if}
