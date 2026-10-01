<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		children: Snippet;
		/** Hover lift, for cards that are not buttons themselves. */
		interactive?: boolean;
		class?: string;
	}

	let { children, interactive = false, class: extra = '' }: Props = $props();
</script>

<div
	class="rounded-card border border-ink-100 bg-surface p-5 shadow-soft transition {interactive
		? 'hover:shadow-lift'
		: ''} {extra}"
>
	{@render children()}
</div>
