<script lang="ts">
	import { lang } from '$lib/store';
	import { translate } from '$lib/i18n';
	import { formatBangkokDateTime } from '$lib/datetime';
	import type { RevisionNote } from '$lib/api';
	import { MessageSquareWarning, ChevronDown } from 'lucide-svelte';

	interface Props {
		/** Newest first, as the API returns them. */
		notes: RevisionNote[];
		/**
		 * 'highlight' = the student's "what needs fixing" box (latest reason first, earlier rounds
		 * collapsed). 'history' = the plain list staff/admin see on the detail page.
		 */
		variant?: 'highlight' | 'history';
		/** Staff/admin see who wrote a note; students only ever get the generic label. */
		showAuthor?: boolean;
		/** Show the "fix the documents, then resubmit" hint (student box only). */
		resubmitHint?: boolean;
	}

	let { notes, variant = 'history', showAuthor = false, resubmitHint = false }: Props = $props();

	let showEarlier = $state(false);

	const latest = $derived(notes[0]);
	const earlier = $derived(notes.slice(1));

	function slotLabel(slot: number): string {
		return translate($lang, slot === 1 ? 'slot1Evidence' : 'slot2Evidence');
	}
	function round(index: number): string {
		return translate($lang, 'revisionRoundLabel').replace('{n}', String(notes.length - index));
	}
	function author(n: RevisionNote): string {
		return showAuthor && n.authorName ? n.authorName : translate($lang, 'revisionAuthorStaff');
	}
</script>

{#snippet noteBody(n: RevisionNote, label: string)}
	<div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-600">
		<span class="font-semibold text-ink-800">{label}</span>
		<span>·</span>
		<span>{author(n)}</span>
		<span>·</span>
		<span>{formatBangkokDateTime(n.createdAt, $lang)}</span>
	</div>
	<p class="mt-1.5 whitespace-pre-wrap break-words text-sm text-ink-900">{n.note}</p>
	{#if n.slots.length > 0}
		<p class="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-ink-600">
			<span class="font-medium">{translate($lang, 'revisionSlotsToFix')}:</span>
			{#each n.slots as slot (slot)}
				<span class="rounded-full bg-surface px-2 py-0.5 font-semibold text-revision ring-1 ring-revision-ring">
					{slot}. {slotLabel(slot)}
				</span>
			{/each}
		</p>
	{/if}
{/snippet}

{#if notes.length > 0}
	{#if variant === 'highlight' && latest}
		<section
			class="rounded-card border-2 border-revision-ring bg-revision-soft p-4"
			aria-label={translate($lang, 'revisionNeededTitle')}
		>
			<h3 class="flex items-center gap-2 text-base font-bold text-revision">
				<MessageSquareWarning size={20} aria-hidden="true" />
				{translate($lang, 'revisionNeededTitle')}
			</h3>
			<div class="mt-2">
				{@render noteBody(latest, translate($lang, 'revisionLatestReason'))}
			</div>
			{#if resubmitHint}
				<p class="mt-3 text-sm font-medium text-revision">{translate($lang, 'revisionResubmitHint')}</p>
			{/if}
			{#if earlier.length > 0}
				<button
					type="button"
					onclick={() => (showEarlier = !showEarlier)}
					aria-expanded={showEarlier}
					class="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-control text-sm font-semibold text-revision underline-offset-2 hover:underline"
				>
					<ChevronDown size={16} class={showEarlier ? 'rotate-180 transition-transform' : 'transition-transform'} aria-hidden="true" />
					{showEarlier
						? translate($lang, 'revisionHistoryHide')
						: translate($lang, 'revisionHistoryShow').replace('{count}', String(earlier.length))}
				</button>
				{#if showEarlier}
					<ol class="mt-2 space-y-2">
						{#each earlier as n, i (n.id)}
							<li class="rounded-xl bg-surface/70 p-3">{@render noteBody(n, round(i + 1))}</li>
						{/each}
					</ol>
				{/if}
			{/if}
		</section>
	{:else}
		<section aria-label={translate($lang, 'revisionHistoryTitle')}>
			<h3 class="mb-2 text-sm font-semibold text-ink-700">{translate($lang, 'revisionHistoryTitle')}</h3>
			<ol class="space-y-2">
				{#each notes as n, i (n.id)}
					<li class="rounded-xl border border-revision-ring bg-revision-soft p-3">{@render noteBody(n, round(i))}</li>
				{/each}
			</ol>
		</section>
	{/if}
{/if}
