<script lang="ts" module>
	export type BadgeKind =
		| 'pending'
		| 'revision_required'
		| 'approved'
		| 'rejected'
		| 'checked'
		| 'neutral';
</script>

<script lang="ts">
	import { lang } from '$lib/store';
	import { translate } from '$lib/i18n';
	import { BadgeCheck } from 'lucide-svelte';

	interface Props {
		kind: BadgeKind;
		/** Overrides the default translated label. */
		label?: string;
	}

	let { kind, label }: Props = $props();

	const classes: Record<BadgeKind, string> = {
		pending: 'bg-pending-soft text-pending ring-pending-ring',
		revision_required: 'bg-revision-soft text-revision ring-revision-ring',
		approved: 'bg-approved-soft text-approved ring-approved-ring',
		rejected: 'bg-rejected-soft text-rejected ring-rejected-ring',
		checked: 'bg-checked-soft text-checked ring-checked-ring',
		neutral: 'bg-ink-50 text-ink-600 ring-ink-200',
	};

	let text = $derived(
		label ??
			(kind === 'revision_required'
				? translate($lang, 'revisionRequired')
				: kind === 'checked'
					? translate($lang, 'staffCheckedBadge')
					: kind === 'neutral'
						? ''
						: translate($lang, kind)),
	);
</script>

<span
	class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ring-1 {classes[kind]}"
>
	{#if kind === 'checked'}<BadgeCheck size={13} aria-hidden="true" />{/if}
	{text}
</span>
