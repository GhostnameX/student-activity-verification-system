<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { FileText } from 'lucide-svelte';

	interface Props {
		title: string;
		subtitle?: string;
		icon?: typeof FileText;
		/** Buttons shown on the right (wrap below the title on narrow screens). */
		actions?: Snippet;
	}

	let { title, subtitle, icon: Icon, actions }: Props = $props();
</script>

<div class="flex flex-wrap items-center justify-between gap-3">
	<div class="min-w-0">
		<h1 class="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-ink-900 sm:text-3xl">
			{#if Icon}<Icon size={26} class="shrink-0 text-brand-600" aria-hidden="true" />{/if}
			<span class="min-w-0 break-words">{title}</span>
		</h1>
		{#if subtitle}<p class="mt-1 text-sm text-ink-500">{subtitle}</p>{/if}
	</div>
	{#if actions}<div class="flex flex-wrap items-center gap-2">{@render actions()}</div>{/if}
</div>
