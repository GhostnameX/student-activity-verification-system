<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		children: Snippet;
		variant?: 'primary' | 'secondary' | 'dark' | 'danger';
		href?: string;
		type?: 'button' | 'submit';
		disabled?: boolean;
		class?: string;
		onclick?: (event: MouseEvent) => void;
		[key: string]: unknown;
	}

	let {
		children,
		variant = 'secondary',
		href,
		type = 'button',
		disabled = false,
		class: extra = '',
		onclick,
		...rest
	}: Props = $props();

	const variants = {
		primary: 'bg-brand-600 text-white shadow-soft hover:bg-brand-700',
		secondary: 'border border-ink-200 bg-surface text-ink-700 shadow-soft hover:bg-ink-50',
		dark: 'bg-ink-900 text-ink-50 shadow-soft hover:bg-ink-800',
		danger: 'bg-red-600 text-white shadow-soft hover:bg-red-700',
	};
	let classes = $derived(
		`inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${extra}`,
	);
</script>

{#if href}
	<a {href} class={classes} {...rest}>{@render children()}</a>
{:else}
	<button {type} {disabled} {onclick} class={classes} {...rest}>{@render children()}</button>
{/if}
