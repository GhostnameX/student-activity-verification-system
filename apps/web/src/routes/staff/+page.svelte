<script lang="ts">
	import { onMount } from 'svelte';
	import { lang } from '$lib/store';
	import { user } from '$lib/auth';
	import { translate } from '$lib/i18n';
	import { goto } from '$app/navigation';
	import {
		getRequests,
		getRequest,
		approveRequest,
		rejectRequest,
		attachmentUrl,
		type RequestItem,
	} from '$lib/api';
	import { Check, X, RefreshCw, Inbox, Clock, Paperclip, FileText as FileIcon } from 'lucide-svelte';

	let requests: RequestItem[] = $state([]);
	let loading: boolean = $state(true);
	let actionMsg: string = $state('');
	let rejectId: string | null = $state(null);
	let rejectReason: string = $state('');
	let detail: RequestItem | null = $state(null);
	let detailLoading: boolean = $state(false);

	onMount(async () => {
		if (!$user || ($user.role !== 'staff' && $user.role !== 'admin')) {
			goto('/auth/signin');
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
			await refresh();
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
			await refresh();
		} catch (e) {
			actionMsg = e instanceof Error ? e.message : String(e);
		}
	}

	async function openDetail(id: string) {
		detailLoading = true;
		detail = null;
		try {
			detail = await getRequest(id);
		} catch (e) {
			actionMsg = e instanceof Error ? e.message : String(e);
		} finally {
			detailLoading = false;
		}
	}

	function statusClass(status: string) {
		if (status === 'approved') return 'bg-green-50 text-green-700 ring-1 ring-green-200';
		if (status === 'rejected') return 'bg-red-50 text-red-700 ring-1 ring-red-200';
		return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200';
	}

	let pendingCount = $derived(requests.filter((r) => r.status === 'pending').length);
</script>

<div class="space-y-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="text-3xl font-extrabold tracking-tight text-ink-900">
				{translate($lang, 'allRequests')}
			</h1>
			<p class="mt-1 text-sm text-ink-500">
				{pendingCount} {translate($lang, 'totalPending').toLowerCase()}
			</p>
		</div>
		<button
			onclick={refresh}
			class="flex items-center gap-1.5 rounded-xl border border-ink-200 bg-white px-4 py-2 text-sm font-medium text-ink-700 shadow-soft transition hover:bg-ink-50"
		>
			<RefreshCw size={15} />
			{translate($lang, 'refresh')}
		</button>
	</div>

	{#if actionMsg}
		<div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
			{actionMsg}
		</div>
	{/if}

	{#if loading}
		<div class="flex items-center gap-2 py-12 text-sm text-ink-500">
			<Clock size={16} class="animate-spin" />
			{translate($lang, 'submitting')}
		</div>
	{:else if requests.length === 0}
		<div class="rounded-2xl border border-dashed border-ink-200 bg-white/60 px-6 py-12 text-center">
			<Inbox size={30} class="mx-auto mb-2 text-ink-300" />
			<p class="text-sm text-ink-500">{translate($lang, 'noRequests')}</p>
		</div>
	{:else}
		<div class="overflow-x-auto rounded-3xl border border-ink-100 bg-white shadow-soft">
			<table class="w-full text-left text-sm">
				<thead class="border-b border-ink-100 bg-ink-50/70 text-xs font-semibold uppercase tracking-wide text-ink-500">
					<tr>
						<th class="px-5 py-3.5">{translate($lang, 'activity')}</th>
						<th class="px-5 py-3.5">{translate($lang, 'student')}</th>
						<th class="hidden px-5 py-3.5 md:table-cell">{translate($lang, 'faculty')}</th>
						<th class="hidden px-5 py-3.5 lg:table-cell">{translate($lang, 'date')}</th>
						<th class="px-5 py-3.5">{translate($lang, 'status')}</th>
						<th class="px-5 py-3.5 text-right">{translate($lang, 'actions')}</th>
					</tr>
				</thead>
				<tbody>
					{#each requests as r (r.id)}
						<tr
							class="cursor-pointer border-b border-ink-50 transition last:border-0 hover:bg-ink-50/50"
							onclick={() => openDetail(r.id)}
						>
							<td class="px-5 py-4 font-medium text-ink-900">
								{$lang === 'th' ? r.activity.title : r.activity.titleEn}
							</td>
							<td class="px-5 py-4">
								<div class="font-medium text-ink-800">{r.student?.name}</div>
								<div class="text-xs text-ink-400">{r.student?.email}</div>
							</td>
							<td class="hidden px-5 py-4 text-ink-600 md:table-cell">
								{r.student?.faculty ?? '-'}
							</td>
							<td class="hidden px-5 py-4 text-ink-600 lg:table-cell">
								{new Date(r.activity.date).toLocaleDateString($lang === 'th' ? 'th-TH' : 'en-US')}
							</td>
							<td class="px-5 py-4">
								<span
									class={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusClass(r.status)}`}
								>
									{translate($lang, r.status as 'pending')}
								</span>
							</td>
							<td class="px-5 py-4">
								{#if r.status === 'pending'}
									<div class="flex justify-end gap-2">
										<button
											onclick={(e) => { e.stopPropagation(); approve(r.id); }}
											class="flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white shadow-soft transition hover:bg-green-700"
										>
											<Check size={14} />
											{translate($lang, 'approve')}
										</button>
										<button
											onclick={(e) => { e.stopPropagation(); rejectId = r.id; }}
											class="flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white shadow-soft transition hover:bg-red-700"
										>
											<X size={14} />
											{translate($lang, 'reject')}
										</button>
									</div>
								{:else}
									{#if r.status === 'rejected' && r.note}
										<span class="text-xs text-red-600">{r.note}</span>
									{/if}
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	{#if detailLoading || detail}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/50 p-4 backdrop-blur-sm"
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			onclick={(e) => { if (e.target === e.currentTarget) detail = null; }}
			onkeydown={(e) => { if (e.key === 'Escape') detail = null; }}
		>
			<div class="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-6 shadow-lift">
				{#if detailLoading}
					<div class="flex items-center gap-2 py-12 text-sm text-ink-500">
						<Clock size={16} class="animate-spin" />
						{translate($lang, 'submitting')}
					</div>
				{:else if detail}
					<div class="mb-4 flex items-start justify-between gap-3">
						<div>
							<h3 class="text-lg font-bold text-ink-900">
								{$lang === 'th' ? detail.activity.title : detail.activity.titleEn}
							</h3>
							<span
								class={`mt-1 inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusClass(detail.status)}`}
							>
								{translate($lang, detail.status as 'pending')}
							</span>
						</div>
						<button
							onclick={() => (detail = null)}
							class="rounded-lg p-1.5 text-ink-400 transition hover:bg-ink-50 hover:text-ink-700"
							aria-label={translate($lang, 'cancel')}
						>
							<X size={18} />
						</button>
					</div>

					<div class="mb-5 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
						<div>
							<span class="text-ink-400">{translate($lang, 'student')}: </span>
							<span class="font-medium text-ink-800">{detail.student?.name}</span>
						</div>
						<div>
							<span class="text-ink-400">{translate($lang, 'faculty')}: </span>
							<span class="font-medium text-ink-800">{detail.student?.faculty ?? '-'}</span>
						</div>
						<div>
							<span class="text-ink-400">{translate($lang, 'studentId')}: </span>
							<span class="font-medium text-ink-800">{detail.student?.studentId ?? '-'}</span>
						</div>
						<div>
							<span class="text-ink-400">{translate($lang, 'submittedAt')}: </span>
							<span class="font-medium text-ink-800">
								{new Date(detail.submittedAt).toLocaleString($lang === 'th' ? 'th-TH' : 'en-US')}
							</span>
						</div>
					</div>

					{#if detail.note}
						<div class="mb-5">
							<div class="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-400">
								{translate($lang, 'note')}
							</div>
							<p class="rounded-xl bg-ink-50 px-3.5 py-2.5 text-sm text-ink-700">{detail.note}</p>
						</div>
					{/if}

					<div class="mb-5">
						<div class="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">
							<Paperclip size={13} />
							{translate($lang, 'attachments')}
						</div>
						{#if !detail.attachments || detail.attachments.length === 0}
							<p class="text-sm text-ink-400">{translate($lang, 'noFiles')}</p>
						{:else}
							<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
								{#each detail.attachments as a (a.id)}
									<a
										href={attachmentUrl(a.storagePath)}
										target="_blank"
										rel="noopener noreferrer"
										class="group flex flex-col items-center gap-2 rounded-2xl border border-ink-100 bg-ink-50/60 p-3 text-center transition hover:border-brand-300 hover:bg-brand-50"
									>
										{#if a.fileType.startsWith('image/')}
											<img
												src={attachmentUrl(a.storagePath)}
												alt={a.fileName}
												class="h-20 w-full rounded-lg object-cover"
											/>
										{:else}
											<div class="flex h-20 w-full items-center justify-center rounded-lg bg-white">
												<FileIcon size={28} class="text-ink-300" />
											</div>
										{/if}
										<span class="line-clamp-1 w-full text-xs font-medium text-ink-700 group-hover:text-brand-700">
											{a.fileName}
										</span>
										<span class="text-[11px] text-ink-400">{translate($lang, 'download')}</span>
									</a>
								{/each}
							</div>
						{/if}
					</div>

					{#if detail.status === 'pending'}
						<div class="flex justify-end gap-2 border-t border-ink-100 pt-4">
							<button
								onclick={() => approve(detail!.id)}
								class="flex items-center gap-1 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-soft transition hover:bg-green-700"
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
					{:else if detail.status === 'rejected' && detail.note}
						<div class="border-t border-ink-100 pt-4 text-sm text-red-600">
							{translate($lang, 'reason')}: {detail.note}
						</div>
					{/if}
				{/if}
			</div>
		</div>
	{/if}

	{#if rejectId}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/50 p-4 backdrop-blur-sm"
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			onkeydown={(e) => { if (e.key === 'Escape') rejectId = null; }}
		>
			<div class="w-full max-w-md rounded-3xl bg-white p-6 shadow-lift">
				<h3 class="mb-4 text-lg font-bold text-ink-900">{translate($lang, 'reject')}</h3>
				<label for="reject-reason" class="mb-1.5 block text-sm font-medium text-ink-700">
					{translate($lang, 'reason')}
				</label>
				<textarea
					id="reject-reason"
					bind:value={rejectReason}
					rows={3}
					class="mb-4 w-full rounded-xl border border-ink-200 bg-ink-50 px-3.5 py-2.5 text-sm transition focus:border-red-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-red-100"
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
</div>
