<script lang="ts">
	import { onMount } from 'svelte';
	import { lang } from '$lib/store';
	import { user, loadSession } from '$lib/auth';
	import { translate } from '$lib/i18n';
	import { formatBangkokDate, formatBangkokDateTime } from '$lib/datetime';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Button from '$lib/components/Button.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import RevisionNotes from '$lib/components/RevisionNotes.svelte';
	import { goto } from '$app/navigation';
	import {
		getRequests,
		getRequest,
		approveRequest,
		rejectRequest,
		requestRevisionRequest,
		REVISION_NOTE_MAX_LENGTH,
		attachmentUrl,
		type RequestItem,
		type Attachment,
	} from '$lib/api';
	import {
		Check,
		X,
		RefreshCw,
		Inbox,
		Clock,
		Paperclip,
		FileText as FileIcon,
		RotateCcw,
		BadgeCheck,
	} from 'lucide-svelte';

	let requests: RequestItem[] = $state([]);
	let loading: boolean = $state(true);
	let actionMsg: string = $state('');
	let rejectId: string | null = $state(null);
	let rejectReason: string = $state('');
	let detail: RequestItem | null = $state(null);
	let detailLoading: boolean = $state(false);
	let attachmentUrls: Record<string, string> = $state({});
	let removingId: string | null = $state(null);
	let removingStatus: 'approved' | 'rejected' = $state('approved');

	function animateRemove(id: string, status: 'approved' | 'rejected') {
		removingId = id;
		removingStatus = status;
		setTimeout(async () => {
			removingId = null;
			await refresh();
		}, 600);
	}

	onMount(async () => {
		await loadSession();
		if (!$user) {
			goto('/auth/signin');
			return;
		}
		if ($user.role !== 'admin') {
			goto('/stats');
			return;
		}
		await refresh();
	});

	async function refresh() {
		loading = true;
		try {
			requests = await getRequests();
		} finally {
			loading = false;
		}
	}

	async function approve(id: string) {
		try {
			await approveRequest(id);
			if (detail?.id === id) detail = null;
			animateRemove(id, 'approved');
		} catch (e) {
			actionMsg = e instanceof Error ? e.message : String(e);
		}
	}

	async function doReject(id: string) {
		try {
			await rejectRequest(id, rejectReason || undefined);
			rejectId = null;
			rejectReason = '';
			if (detail?.id === id) detail = null;
			animateRemove(id, 'rejected');
		} catch (e) {
			actionMsg = e instanceof Error ? e.message : String(e);
		}
	}

	async function openDetail(id: string) {
		detailLoading = true;
		detail = null;
		attachmentUrls = {};
		try {
			const request = await getRequest(id);
			const entries = await Promise.all(
				(request.attachments ?? []).map(async (attachment) => [
					attachment.id,
					await attachmentUrl(attachment.id),
				] as const),
			);
			attachmentUrls = Object.fromEntries(entries);
			detail = request;
		} catch (e) {
			actionMsg = e instanceof Error ? e.message : String(e);
		} finally {
			detailLoading = false;
		}
	}

	function requestTitle(r: RequestItem) {
		return r.requestNumber
			? `${translate($lang, 'requestNumber')}: ${r.requestNumber}`
			: translate($lang, 'allRequests');
	}

	let pendingCount = $derived(requests.filter((r) => r.status === 'pending').length);

	// Revision request state
	let revisionFor: RequestItem | null = $state(null);
	let revisionRequest: RequestItem | null = $state(null);
	let revisionLoading = $state(false);
	let revisionSelected = $state<Record<number, boolean>>({});
	let revisionMsg = $state('');
	let revisionNote = $state('');

	async function openRevision(id: string) {
		revisionFor = null;
		revisionMsg = '';
		revisionNote = '';
		revisionSelected = {};
		revisionLoading = true;
		try {
			const r = await getRequest(id);
			revisionRequest = r;
			revisionFor = r;
		} catch (e) {
			revisionMsg = e instanceof Error ? e.message : String(e);
		} finally {
			revisionLoading = false;
		}
	}

	function flaggableSlots(r: RequestItem): Attachment[] {
		return (r.attachments ?? []).filter(
			(a) => a.slot === 1 || a.slot === 2,
		);
	}

	async function doRequestRevision() {
		if (!revisionFor) return;
		const id = revisionFor.id;
		const slots = Object.keys(revisionSelected)
			.filter((k) => revisionSelected[Number(k)])
			.map(Number)
			.sort();
		if (slots.length === 0) {
			revisionMsg = translate($lang, 'selectAtLeastOne');
			return;
		}
		const note = revisionNote.trim();
		if (note.length === 0) {
			revisionMsg = translate($lang, 'revisionNoteRequired');
			return;
		}
		actionMsg = '';
		try {
			await requestRevisionRequest(id, slots, note);
			revisionFor = null;
			revisionRequest = null;
			if (detail?.id === id) detail = null;
			await refresh();
		} catch (e) {
			revisionMsg = e instanceof Error ? e.message : String(e);
		}
	}

	function revisionStateLabel(state: string) {
		if (state === 'needs_revision') return translate($lang, 'revisionStateNeedsRevision');
		if (state === 'resubmitted') return translate($lang, 'revisionStateResubmitted');
		if (state === 'approved') return translate($lang, 'approved');
		return translate($lang, 'revisionStateUnchanged');
	}

	function revisionStateClass(state: string) {
		if (state === 'needs_revision') return 'bg-rejected-soft text-rejected ring-1 ring-rejected-ring';
		if (state === 'resubmitted') return 'bg-checked-soft text-checked ring-1 ring-checked-ring';
		if (state === 'approved') return 'bg-approved-soft text-approved ring-1 ring-approved-ring';
		return 'bg-ink-100 text-ink-600 ring-1 ring-ink-200';
	}
</script>

{#snippet badges(r: RequestItem)}
	<div class="flex flex-wrap items-center gap-1.5">
		<StatusBadge kind={r.status} />
		{#if r.staffCheckedAt}
			<span title={formatBangkokDateTime(r.staffCheckedAt, $lang)}>
				<StatusBadge kind="checked" />
			</span>
		{/if}
	</div>
	{#if r.status === 'rejected' && r.rejectionReason}
		<p class="mt-1.5 break-words text-xs text-rejected">
			{translate($lang, 'reason')}: {r.rejectionReason}
		</p>
	{/if}
{/snippet}

{#snippet actionCell(r: RequestItem)}
	{#if r.status === 'pending'}
		{#if $user?.role === 'admin'}
			<div class="flex flex-wrap gap-2 md:flex-nowrap md:justify-end">
				<button
					onclick={(e) => { e.stopPropagation(); openRevision(r.id); }}
					title={translate($lang, 'requestRevision')}
					class="flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-control bg-orange-700 px-3 py-2 text-xs font-semibold text-white shadow-soft transition hover:bg-orange-800"
				>
					<RotateCcw size={14} aria-hidden="true" />
					<span class="md:max-lg:sr-only">{translate($lang, 'requestRevision')}</span>
				</button>
				<button
					onclick={(e) => { e.stopPropagation(); approve(r.id); }}
					title={translate($lang, 'approve')}
					class="flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-control bg-green-700 px-3 py-2 text-xs font-semibold text-white shadow-soft transition hover:bg-green-800"
				>
					<Check size={14} aria-hidden="true" />
					<span class="md:max-lg:sr-only">{translate($lang, 'approve')}</span>
				</button>
				<button
					onclick={(e) => { e.stopPropagation(); rejectId = r.id; }}
					title={translate($lang, 'reject')}
					class="flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-control bg-red-700 px-3 py-2 text-xs font-semibold text-white shadow-soft transition hover:bg-red-800"
				>
					<X size={14} aria-hidden="true" />
					<span class="md:max-lg:sr-only">{translate($lang, 'reject')}</span>
				</button>
			</div>
		{:else}
			<span class="text-xs text-ink-500">{translate($lang, 'readOnly')}</span>
		{/if}
	{/if}
{/snippet}

<div class="space-y-6">
	<PageHeader
		title={translate($lang, 'allRequests')}
		subtitle="{pendingCount} {translate($lang, 'totalPending').toLowerCase()}"
	>
		{#snippet actions()}
			<Button onclick={refresh}>
				<RefreshCw size={15} aria-hidden="true" />
				{translate($lang, 'refresh')}
			</Button>
		{/snippet}
	</PageHeader>

	{#if actionMsg}
		<div class="rounded-xl border border-rejected-ring bg-rejected-soft px-4 py-3 text-sm text-rejected">
			{actionMsg}
		</div>
	{/if}

	{#if loading}
		<div class="flex items-center gap-2 py-12 text-sm text-ink-500">
			<Clock size={16} class="animate-spin" />
			{translate($lang, 'submitting')}
		</div>
	{:else if requests.length === 0}
		<EmptyState message={translate($lang, 'noRequests')} />
	{:else}
		<!-- table from md up -->
		<div class="hidden overflow-x-auto rounded-card border border-ink-100 bg-surface shadow-soft md:block">
			<table class="w-full text-left text-sm">
				<thead class="border-b border-ink-100 bg-ink-50/70 text-xs font-semibold uppercase tracking-wide text-ink-500">
					<tr>
						<th class="px-5 py-3.5">{translate($lang, 'student')}</th>
						<th class="px-5 py-3.5">{translate($lang, 'faculty')}</th>
						<th class="hidden px-5 py-3.5 lg:table-cell">{translate($lang, 'date')}</th>
						<th class="px-5 py-3.5">{translate($lang, 'status')}</th>
						<th class="px-5 py-3.5 text-right">{translate($lang, 'actions')}</th>
					</tr>
				</thead>
				<tbody>
					{#each requests as r (r.id)}
						<tr
							class="cursor-pointer border-b border-ink-50 transition last:border-0 hover:bg-ink-50/50 {removingId === r.id ? (removingStatus === 'approved' ? 'row-out-approve' : 'row-out-reject') : ''}"
							onclick={() => openDetail(r.id)}
						>
							<td class="px-5 py-4">
								<div class="font-medium text-ink-800">{r.student?.name}</div>
								<div class="text-xs text-ink-500">{r.student?.email}</div>
							</td>
							<td class="px-5 py-4 text-ink-600">{r.student?.faculty ?? '-'}</td>
							<td class="hidden px-5 py-4 text-ink-600 lg:table-cell">
								{formatBangkokDate(r.submittedAt, $lang)}
							</td>
							<td class="px-5 py-4">
								{@render badges(r)}
							</td>
							<td class="whitespace-nowrap px-5 py-4">
								{@render actionCell(r)}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<!-- cards below md -->
		<ul class="space-y-3 md:hidden">
			{#each requests as r (r.id)}
				<li
					class="rounded-card border border-ink-100 bg-surface p-4 shadow-soft {removingId === r.id ? (removingStatus === 'approved' ? 'row-out-approve' : 'row-out-reject') : ''}"
				>
					<button type="button" class="block w-full text-left" onclick={() => openDetail(r.id)}>
						<div class="break-words font-semibold text-ink-900">{r.student?.name}</div>
						<div class="mt-0.5 break-all text-xs text-ink-500">{r.student?.email}</div>
						<div class="mt-1 break-words text-xs text-ink-500">{r.student?.faculty ?? '-'}</div>
						<div class="mt-0.5 text-xs text-ink-500">{formatBangkokDate(r.submittedAt, $lang)}</div>
						<div class="mt-2.5">{@render badges(r)}</div>
					</button>
					<div class="mt-3">{@render actionCell(r)}</div>
				</li>
			{/each}
		</ul>
	{/if}

	{#if detailLoading || detail}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			onclick={(e) => { if (e.target === e.currentTarget) detail = null; }}
			onkeydown={(e) => { if (e.key === 'Escape') detail = null; }}
		>
			<div class="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-card bg-surface p-6 shadow-lift">
				{#if detailLoading}
					<div class="flex items-center gap-2 py-12 text-sm text-ink-500">
						<Clock size={16} class="animate-spin" />
						{translate($lang, 'submitting')}
					</div>
				{:else if detail}
					<div class="mb-4 flex items-start justify-between gap-3">
						<div>
							<h3 class="text-lg font-bold text-ink-900">
								{requestTitle(detail)}
							</h3>
							<div class="mt-1"><StatusBadge kind={detail.status} /></div>
						</div>
						<button
							onclick={() => (detail = null)}
							class="rounded-lg p-1.5 text-ink-500 transition hover:bg-ink-50 hover:text-ink-700"
							aria-label={translate($lang, 'cancel')}
						>
							<X size={18} />
						</button>
					</div>

					<div class="mb-5 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
						<div>
							<span class="text-ink-500">{translate($lang, 'student')}: </span>
							<span class="font-medium text-ink-800">{detail.student?.name}</span>
						</div>
						<div>
							<span class="text-ink-500">{translate($lang, 'faculty')}: </span>
							<span class="font-medium text-ink-800">{detail.student?.faculty ?? '-'}</span>
						</div>
						<div>
							<span class="text-ink-500">{translate($lang, 'studentId')}: </span>
							<span class="font-medium text-ink-800">{detail.student?.studentId ?? '-'}</span>
						</div>
						<div>
							<span class="text-ink-500">{translate($lang, 'submittedAt')}: </span>
							<span class="font-medium text-ink-800">
								{formatBangkokDateTime(detail.submittedAt, $lang)}
							</span>
						</div>
					</div>

					{#if detail.staffCheckedAt}
						<div
							class="mb-5 flex items-start gap-2 rounded-xl bg-checked-soft px-4 py-3 text-sm text-checked ring-1 ring-checked-ring"
						>
							<BadgeCheck size={18} class="mt-0.5 shrink-0" />
							<div>
								<div class="font-semibold">{translate($lang, 'staffCheckedBadge')}</div>
								<div class="text-xs">
									{translate($lang, 'staffCheckedAtLabel')}:
									{formatBangkokDateTime(detail.staffCheckedAt, $lang)}
									{#if detail.staffCheckedByName}
										· {translate($lang, 'staffCheckedBy')} {detail.staffCheckedByName}
									{/if}
								</div>
							</div>
						</div>
					{/if}

					{#if detail.revisionNotes && detail.revisionNotes.length > 0}
						<div class="mb-5">
							<RevisionNotes notes={detail.revisionNotes} showAuthor={true} />
						</div>
					{/if}

					{#if detail.note}
						<div class="mb-5">
							<div class="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">
								{translate($lang, 'note')}
							</div>
							<p class="rounded-xl bg-ink-50 px-3.5 py-2.5 text-sm text-ink-700">{detail.note}</p>
						</div>
					{/if}

					<div class="mb-5">
						<div class="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">
							<Paperclip size={13} />
							{translate($lang, 'attachments')}
						</div>
						{#if !detail.attachments || detail.attachments.length === 0}
							<p class="text-sm text-ink-500">{translate($lang, 'noFiles')}</p>
						{:else}
							<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
								{#each detail.attachments as a (a.id)}
									<a
										href={attachmentUrls[a.id]}
										target="_blank"
										rel="noopener noreferrer"
										class="group flex flex-col items-center gap-2 rounded-2xl border border-ink-100 bg-ink-50/60 p-3 text-center transition hover:border-brand-300 hover:bg-brand-50"
									>
										{#if a.fileType.startsWith('image/')}
											<img
												src={attachmentUrls[a.id]}
												alt={a.fileName}
												class="h-20 w-full rounded-lg object-cover"
											/>
										{:else}
											<div class="flex h-20 w-full items-center justify-center rounded-lg bg-surface">
												<FileIcon size={28} class="text-ink-300" />
											</div>
										{/if}
										<span class="line-clamp-1 w-full text-xs font-medium text-ink-700 group-hover:text-brand-700">
											{a.fileName}
										</span>
										<span class="text-[11px] text-ink-500">{translate($lang, 'download')}</span>
									</a>
								{/each}
							</div>
						{/if}
					</div>

					{#if detail.status === 'pending'}
						{#if $user?.role !== 'admin'}
							<div class="border-t border-ink-100 pt-4 text-sm text-ink-500">
								{translate($lang, 'readOnly')}
							</div>
						{:else}
							<div class="flex justify-end gap-2 border-t border-ink-100 pt-4">
								<button
									onclick={(e) => { e.stopPropagation(); openRevision(detail!.id); }}
									class="flex items-center gap-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-soft transition hover:bg-indigo-700"
								>
									<RotateCcw size={15} />
									{translate($lang, 'requestRevision')}
								</button>
								<button
									onclick={() => approve(detail!.id)}
									class="flex items-center gap-1 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white shadow-soft transition hover:bg-green-800"
								>
									<Check size={15} />
									{translate($lang, 'approve')}
								</button>
								<button
									onclick={() => (rejectId = detail!.id)}
									class="flex items-center gap-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-soft transition hover:bg-red-700"
								>
									<X size={15} />
									{translate($lang, 'reject')}
								</button>
							</div>
						{/if}
					{:else if detail.status === 'rejected' && detail.rejectionReason}
						<div class="border-t border-ink-100 pt-4 text-sm text-rejected">
							{translate($lang, 'reason')}: {detail.rejectionReason}
						</div>
					{/if}
				{/if}
			</div>
		</div>
	{/if}

	{#if rejectId}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			onkeydown={(e) => { if (e.key === 'Escape') rejectId = null; }}
		>
			<div class="w-full max-w-md rounded-card bg-surface p-6 shadow-lift">
				<h3 class="mb-4 text-lg font-bold text-ink-900">{translate($lang, 'reject')}</h3>
				<label for="reject-reason" class="mb-1.5 block text-sm font-medium text-ink-700">
					{translate($lang, 'reason')}
				</label>
				<textarea
					id="reject-reason"
					bind:value={rejectReason}
					rows={3}
					class="mb-4 w-full rounded-xl border border-ink-200 bg-ink-50 px-3.5 py-2.5 text-sm transition focus:border-red-400 focus:bg-surface focus:outline-none focus:ring-4 focus:ring-red-100"
				></textarea>
				<div class="flex justify-end gap-2">
					<button
						onclick={() => (rejectId = null)}
						class="rounded-xl border border-ink-200 px-4 py-2 text-sm font-medium text-ink-700 transition hover:bg-ink-50"
					>
						{translate($lang, 'cancel')}
					</button>
					<button
						onclick={() => rejectId && doReject(rejectId)}
						class="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-soft transition hover:bg-red-700"
					>
						{translate($lang, 'confirm')}
					</button>
				</div>
			</div>
		</div>
	{/if}

	{#if revisionLoading || revisionFor}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			onkeydown={(e) => { if (e.key === 'Escape') { revisionFor = null; revisionRequest = null; } }}
		>
			<div class="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-card bg-surface p-6 shadow-lift">
				{#if revisionLoading}
					<div class="flex items-center gap-2 py-12 text-sm text-ink-500">
						<Clock size={16} class="animate-spin" />
						{translate($lang, 'submitting')}
					</div>
				{:else if revisionFor}
					<div class="mb-4 flex items-start justify-between gap-3">
						<div>
							<h3 class="text-lg font-bold text-ink-900">{translate($lang, 'requestRevision')}</h3>
							<p class="mt-1 text-sm text-ink-500">{translate($lang, 'requestRevisionHint')}</p>
						</div>
						<button
							onclick={() => { revisionFor = null; revisionRequest = null; }}
							class="rounded-lg p-1.5 text-ink-500 transition hover:bg-ink-50 hover:text-ink-700"
							aria-label={translate($lang, 'cancel')}
						>
							<X size={18} />
						</button>
					</div>

					{#if revisionMsg}
						<p class="mb-3 rounded-xl border border-rejected-ring bg-rejected-soft px-3 py-2 text-sm text-rejected">
							{revisionMsg}
						</p>
					{/if}

					{#if flaggableSlots(revisionFor).length === 0}
						<p class="rounded-xl bg-ink-50 px-3.5 py-2.5 text-sm text-ink-500">
							{translate($lang, 'noFiles')}
						</p>
					{:else}
						<div class="space-y-3">
							{#each revisionFor.attachments ?? [] as a (a.id)}
								{@const slotLabel = a.slot === 1 ? translate($lang, 'slot1Evidence') : a.slot === 2 ? translate($lang, 'slot2Evidence') : `${translate($lang, 'attachments')} ${a.slot ?? ''}`}
								<label class="flex items-start gap-3 rounded-2xl border border-ink-100 bg-ink-50/50 p-4 transition hover:border-indigo-200">
									<input
										type="checkbox"
										checked={revisionSelected[a.slot ?? -1] ?? false}
										onchange={(e) => {
											const s = a.slot;
											if (s == null) return;
											revisionSelected = { ...revisionSelected, [s]: e.currentTarget.checked };
										}}
										disabled={a.slot !== 1 && a.slot !== 2}
										class="mt-1 h-4 w-4 rounded border-ink-300 text-indigo-600 focus:ring-indigo-500"
									/>
									<span class="min-w-0 flex-1">
										<span class="flex items-center justify-between gap-2">
											<span class="flex items-center gap-2 text-sm font-semibold text-ink-800">
												<span class="flex h-6 w-6 items-center justify-center rounded-lg bg-brand-50 text-xs font-bold text-brand-600">
													{a.slot ?? '-'}
												</span>
												{slotLabel}
											</span>
											{#if a.revisions && a.revisions.length > 0}
												<span
													class={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${revisionStateClass(a.revisions[0].revisionState)}`}
												>
													{revisionStateLabel(a.revisions[0].revisionState)}
												</span>
											{/if}
										</span>
										{#if a.revisions && a.revisions.length > 0}
											<span class="mt-1 block truncate text-xs text-ink-500">
												{a.revisions[0].fileName}
											</span>
										{/if}
									</span>
								</label>
							{/each}
						</div>
					{/if}

					<div class="mt-4">
						<label for="revision-note" class="mb-1.5 block text-sm font-semibold text-ink-800">
							{translate($lang, 'revisionNoteLabel')} <span class="text-rejected" aria-hidden="true">*</span>
						</label>
						<textarea
							id="revision-note"
							bind:value={revisionNote}
							rows="4"
							maxlength={REVISION_NOTE_MAX_LENGTH}
							required
							aria-required="true"
							placeholder={translate($lang, 'revisionNotePlaceholder')}
							class="w-full rounded-control border border-ink-200 bg-surface px-3 py-2 text-sm text-ink-900 placeholder:text-ink-500 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100"
						></textarea>
						<p class="mt-1 text-right text-xs text-ink-500">
							{translate($lang, 'revisionNoteCounter')
								.replace('{count}', String(revisionNote.length))
								.replace('{max}', String(REVISION_NOTE_MAX_LENGTH))}
						</p>
					</div>

					<div class="mt-5 flex justify-end gap-2 border-t border-ink-100 pt-4">
						<button
							onclick={() => { revisionFor = null; revisionRequest = null; }}
							class="rounded-xl border border-ink-200 px-4 py-2 text-sm font-medium text-ink-700 transition hover:bg-ink-50"
						>
							{translate($lang, 'cancel')}
						</button>
						<button
							onclick={doRequestRevision}
							class="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-soft transition hover:bg-indigo-700"
						>
							<RotateCcw size={15} />
							{translate($lang, 'confirm')}
						</button>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.row-out-approve {
		animation: row-out-approve 0.6s ease forwards;
	}

	.row-out-reject {
		animation: row-out-reject 0.6s ease forwards;
	}

	@keyframes row-out-approve {
		0% {
			background-color: rgb(34 197 94 / 0.18);
		}
		60% {
			background-color: rgb(34 197 94 / 0.05);
		}
		100% {
			opacity: 0;
			transform: scale(0.98);
		}
	}

	@keyframes row-out-reject {
		0% {
			background-color: rgb(239 68 68 / 0.18);
		}
		60% {
			background-color: rgb(239 68 68 / 0.05);
		}
		100% {
			opacity: 0;
			transform: scale(0.98);
		}
	}
</style>
