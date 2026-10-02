<script lang="ts">
	import { onMount } from 'svelte';
	import { lang } from '$lib/store';
	import { user, loadSession } from '$lib/auth';
	import { translate } from '$lib/i18n';
	import { formatBangkokDateTime } from '$lib/datetime';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Button from '$lib/components/Button.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { goto } from '$app/navigation';
	import {
		getRequests,
		getRequest,
		attachmentUrl,
		staffCheckRequest,
		type RequestItem,
	} from '$lib/api';
	import {
		BadgeCheck,
		CircleAlert,
		Clock,
		FileText as FileIcon,
		Inbox,
		Paperclip,
		RefreshCw,
		X,
	} from 'lucide-svelte';

	type Filter = 'all' | 'unchecked' | 'checked';

	let requests: RequestItem[] = $state([]);
	let loading = $state(true);
	let loadError = $state('');
	let filter: Filter = $state('unchecked');

	let detail: RequestItem | null = $state(null);
	let detailLoading = $state(false);
	let detailError = $state('');
	let attachmentUrls: Record<string, string> = $state({});

	let confirming = $state(false);
	let checking = $state(false);
	let checkError = $state('');

	onMount(async () => {
		await loadSession();
		if (!$user) {
			goto('/auth/signin');
			return;
		}
		// Staff only: admin decides from /staff, students have their own page.
		if ($user.role !== 'staff') {
			goto($user.role === 'admin' ? '/staff' : '/student');
			return;
		}
		await refresh();
	});

	async function refresh() {
		loading = true;
		loadError = '';
		try {
			requests = await getRequests('pending');
		} catch (e) {
			loadError = errorText(e);
		} finally {
			loading = false;
		}
	}

	function errorText(e: unknown): string {
		const code = e instanceof Error ? e.message : String(e);
		if (code === 'already_checked') return translate($lang, 'staffReviewAlreadyChecked');
		if (code === 'not_pending') return translate($lang, 'staffReviewNotPending');
		return code;
	}

	let visible = $derived(
		requests.filter((r) =>
			filter === 'all' ? true : filter === 'checked' ? !!r.staffCheckedAt : !r.staffCheckedAt,
		),
	);
	let uncheckedCount = $derived(requests.filter((r) => !r.staffCheckedAt).length);

	async function openDetail(id: string) {
		detailLoading = true;
		detail = null;
		detailError = '';
		checkError = '';
		confirming = false;
		attachmentUrls = {};
		try {
			const request = await getRequest(id);
			const entries = await Promise.all(
				(request.attachments ?? []).map(
					async (attachment) => [attachment.id, await attachmentUrl(attachment.id)] as const,
				),
			);
			attachmentUrls = Object.fromEntries(entries);
			detail = request;
		} catch (e) {
			detailError = errorText(e);
			detail = null;
		} finally {
			detailLoading = false;
		}
	}

	// The confirm panel opens below the fold on small screens; keep its buttons reachable.
	function revealInDialog(node: HTMLElement) {
		node.scrollIntoView({ block: 'nearest' });
	}

	function closeDetail() {
		detail = null;
		detailError = '';
		confirming = false;
		checkError = '';
	}

	async function confirmCheck() {
		if (!detail || checking) return;
		const id = detail.id;
		checking = true;
		checkError = '';
		try {
			await staffCheckRequest(id);
			confirming = false;
			// Re-read so the dialog shows the recorded time and checker.
			detail = await getRequest(id);
			await refresh();
		} catch (e) {
			checkError = errorText(e);
			confirming = false;
			await refresh();
		} finally {
			checking = false;
		}
	}

	function requestTitle(r: RequestItem) {
		return r.requestNumber
			? `${translate($lang, 'requestNumber')}: ${r.requestNumber}`
			: translate($lang, 'staffReviewTitle');
	}

	function filterLabel(f: Filter) {
		if (f === 'unchecked') return translate($lang, 'staffReviewFilterUnchecked');
		if (f === 'checked') return translate($lang, 'staffReviewFilterChecked');
		return translate($lang, 'staffReviewFilterAll');
	}
</script>

<div class="space-y-6">
	<PageHeader
		title={translate($lang, 'staffReviewTitle')}
		subtitle={translate($lang, 'staffReviewSubtitle')}
	>
		{#snippet actions()}
			<Button onclick={refresh}>
				<RefreshCw size={15} aria-hidden="true" />
				{translate($lang, 'refresh')}
			</Button>
		{/snippet}
	</PageHeader>

	<div class="flex flex-wrap gap-2" role="group" aria-label={translate($lang, 'status')}>
		{#each ['unchecked', 'checked', 'all'] as const as f (f)}
			<button
				onclick={() => (filter = f)}
				aria-pressed={filter === f}
				class="min-h-11 rounded-full px-4 py-2 text-sm font-semibold transition {filter === f
					? 'bg-brand-solid text-white shadow-soft'
					: 'border border-ink-200 bg-surface text-ink-600 hover:bg-ink-50'}"
			>
				{filterLabel(f)}
				{#if f === 'unchecked'}
					<span class="ml-1 opacity-80">({uncheckedCount})</span>
				{/if}
			</button>
		{/each}
	</div>

	{#if loadError}
		<div class="rounded-xl border border-rejected-ring bg-rejected-soft px-4 py-3 text-sm text-rejected" role="alert">
			{loadError}
		</div>
	{/if}

	{#if loading}
		<div class="flex items-center gap-2 py-12 text-sm text-ink-500">
			<Clock size={16} class="animate-spin" />
			{translate($lang, 'submitting')}
		</div>
	{:else if visible.length === 0}
		<EmptyState message={translate($lang, 'noRequests')} />
	{:else}
		<ul class="space-y-3">
			{#each visible as r (r.id)}
				<li>
					<button
						onclick={() => openDetail(r.id)}
						class="flex w-full flex-wrap items-center justify-between gap-3 rounded-card border border-ink-100 bg-surface p-4 text-left shadow-soft transition hover:shadow-lift"
					>
						<div class="min-w-0">
							<div class="font-semibold text-ink-900">{r.student?.name}</div>
							<div class="mt-0.5 text-xs text-ink-500">
								{r.student?.studentId ?? '-'} · {r.student?.faculty ?? '-'}
							</div>
							<div class="mt-1 text-xs text-ink-500">
								{translate($lang, 'submittedAt')}: {formatBangkokDateTime(r.submittedAt, $lang)}
							</div>
						</div>
						<div class="flex items-center gap-3">
							{#if r.staffCheckedAt}
								<StatusBadge kind="checked" />
							{:else}
								<StatusBadge kind="pending" label={translate($lang, 'staffNotChecked')} />
							{/if}
							<span class="text-sm font-semibold text-brand-700">
								{translate($lang, 'staffReviewOpen')}
							</span>
						</div>
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	{#if detailLoading || detail || detailError}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
			role="dialog"
			aria-modal="true"
			aria-label={translate($lang, 'staffReviewTitle')}
			tabindex="-1"
			onclick={(e) => {
				if (e.target === e.currentTarget) closeDetail();
			}}
			onkeydown={(e) => {
				if (e.key === 'Escape') closeDetail();
			}}
		>
			<div class="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-card bg-surface p-6 shadow-lift">
				{#if detailLoading}
					<div class="flex items-center gap-2 py-12 text-sm text-ink-500">
						<Clock size={16} class="animate-spin" />
						{translate($lang, 'submitting')}
					</div>
				{:else if detailError}
					<div class="flex items-start justify-between gap-3">
						<p class="text-sm text-rejected" role="alert">{detailError}</p>
						<button
							onclick={closeDetail}
							class="rounded-lg p-1.5 text-ink-500 transition hover:bg-ink-50 hover:text-ink-700"
							aria-label={translate($lang, 'cancel')}
						>
							<X size={18} />
						</button>
					</div>
				{:else if detail}
					<div class="mb-4 flex items-start justify-between gap-3">
						<h3 class="text-lg font-bold text-ink-900">{requestTitle(detail)}</h3>
						<button
							onclick={closeDetail}
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
							<span class="text-ink-500">{translate($lang, 'studentId')}: </span>
							<span class="font-medium text-ink-800">{detail.student?.studentId ?? '-'}</span>
						</div>
						<div>
							<span class="text-ink-500">{translate($lang, 'faculty')}: </span>
							<span class="font-medium text-ink-800">{detail.student?.faculty ?? '-'}</span>
						</div>
						<div>
							<span class="text-ink-500">{translate($lang, 'submittedAt')}: </span>
							<span class="font-medium text-ink-800">
								{formatBangkokDateTime(detail.submittedAt, $lang)}
							</span>
						</div>
					</div>

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
									</a>
								{/each}
							</div>
						{/if}
					</div>

					<div class="border-t border-ink-100 pt-4">
						{#if checkError}
							<p class="mb-3 rounded-xl bg-rejected-soft px-3 py-2 text-sm text-rejected" role="alert">
								{checkError}
							</p>
						{/if}

						{#if detail.staffCheckedAt}
							<div
								class="flex items-start gap-2 rounded-xl bg-checked-soft px-4 py-3 text-sm text-checked ring-1 ring-checked-ring"
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
						{:else if detail.status !== 'pending'}
							<p class="text-sm text-ink-500">{translate($lang, 'staffReviewNotPending')}</p>
						{:else if confirming}
							<div
								class="rounded-xl border border-pending-ring bg-pending-soft p-4"
								role="alertdialog"
								aria-labelledby="confirm-title"
								use:revealInDialog
							>
								<div id="confirm-title" class="flex items-center gap-2 font-semibold text-pending">
									<CircleAlert size={18} />
									{translate($lang, 'staffReviewConfirmTitle')}
								</div>
								<p class="mt-2 text-sm text-pending">{translate($lang, 'staffReviewConfirmBody')}</p>
								<div class="mt-4 flex flex-wrap justify-end gap-2">
									<button
										onclick={() => (confirming = false)}
										disabled={checking}
										class="min-h-11 rounded-xl border border-ink-200 bg-surface px-4 py-2 text-sm font-medium text-ink-700 transition hover:bg-ink-50 disabled:opacity-60"
									>
										{translate($lang, 'cancel')}
									</button>
									<button
										onclick={confirmCheck}
										disabled={checking}
										class="min-h-11 rounded-xl bg-brand-solid px-4 py-2 text-sm font-semibold text-white shadow-soft transition hover:bg-brand-solid-hover disabled:opacity-60"
									>
										{translate($lang, 'staffReviewConfirm')}
									</button>
								</div>
							</div>
						{:else}
							<div class="flex justify-end">
								<button
									onclick={() => (confirming = true)}
									class="flex min-h-11 items-center gap-2 rounded-xl bg-brand-solid px-5 py-2 text-sm font-semibold text-white shadow-soft transition hover:bg-brand-solid-hover"
								>
									<BadgeCheck size={16} />
									{translate($lang, 'staffReviewConfirm')}
								</button>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>
