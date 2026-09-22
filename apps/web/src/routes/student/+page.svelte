<script lang="ts">
	import { onMount } from 'svelte';
	import { lang } from '$lib/store';
	import { user } from '$lib/auth';
	import { translate } from '$lib/i18n';
	import { goto } from '$app/navigation';
	import {
		getRequests,
		getRequest,
		createRequest,
		uploadFile,
		resubmitRequest,
		attachmentUrl,
		type RequestItem,
		type AttachmentInput,
		type AttachmentRevision,
	} from '$lib/api';
	import SuccessCheck from '$lib/components/SuccessCheck.svelte';
	import {
		Send,
		FileText,
		CalendarDays,
		Paperclip,
		Upload,
		Clock,
		CircleCheck,
		CircleX,
		CircleAlert,
		RotateCcw,
		RefreshCw,
		ChevronDown,
	} from 'lucide-svelte';

	let requests: RequestItem[] = $state([]);
	let note: string = $state('');
	let slot1File: File | null = $state(null);
	let slot2File: File | null = $state(null);
	let loading: boolean = $state(false);
	let errorMsg: string = $state('');
	let showSuccess: boolean = $state(false);
	let successText: string = $state('');
	let successTimer: ReturnType<typeof setTimeout> | null = $state(null);
	let currentDate: Date | null = $state(null);

	let detail: RequestItem | null = $state(null);
	let detailLoading: boolean = $state(false);
	let resubmitFiles: Record<number, File> = $state({});
	let resubmitting: boolean = $state(false);
	let resubmitMsg: string = $state('');

	function closeSuccess() {
		showSuccess = false;
		if (successTimer) {
			clearTimeout(successTimer);
			successTimer = null;
		}
	}

	function notify(text: string) {
		closeSuccess();
		successText = text;
		showSuccess = true;
		successTimer = setTimeout(closeSuccess, 3500);
	}

	onMount(async () => {
		currentDate = new Date();
		if (!$user || $user.role !== 'student') {
			goto('/auth/signin');
			return;
		}
		requests = await getRequests();
	});

	async function refresh() {
		requests = await getRequests();
	}

	async function uploadToInput(file: File, slot: number): Promise<AttachmentInput> {
		const up = await uploadFile(file);
		return {
			slot,
			fileName: up.fileName ?? file.name,
			fileType: up.fileType ?? file.type,
			fileSize: up.fileSize ?? file.size,
			storagePath: up.storagePath,
		};
	}

	async function submit() {
		loading = true;
		errorMsg = '';
		try {
			if (!slot1File) {
				throw new Error(translate($lang, 'slotMissing'));
			}
			const attachments: AttachmentInput[] = [];
			attachments.push(await uploadToInput(slot1File, 1));
			if (slot2File) {
				attachments.push(await uploadToInput(slot2File, 2));
			}
			const res = await createRequest({
				note: note || undefined,
				attachments,
			});
			note = '';
			slot1File = null;
			slot2File = null;
			await refresh();
			notify(res.requestNumber
				? `${translate($lang, 'requestSubmitted')} — ${translate($lang, 'requestNumber')}: ${res.requestNumber}`
				: translate($lang, 'requestSubmitted'));
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	async function openDetail(id: string) {
		detailLoading = true;
		detail = null;
		resubmitMsg = '';
		resubmitFiles = {};
		try {
			detail = await getRequest(id);
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : String(e);
		} finally {
			detailLoading = false;
		}
	}

	function currentRevision(a: { revisions?: AttachmentRevision[] }): AttachmentRevision | undefined {
		return (a.revisions ?? [])[0];
	}

	function needsResubmitSlots(r: RequestItem): number[] {
		const slots: number[] = [];
		for (const a of r.attachments ?? []) {
			if (a.slot == null || a.slot > 2) continue;
			const cur = currentRevision(a);
			if (cur && cur.revisionState === 'needs_revision') slots.push(a.slot);
		}
		return slots.sort((x, y) => x - y);
	}

	async function doResubmit() {
		const r = detail;
		if (!r) return;
		const slots = needsResubmitSlots(r);
		const toUpload = slots.filter((s) => resubmitFiles[s]);
		if (toUpload.length === 0) {
			resubmitMsg = translate($lang, 'resubmitEmpty');
			return;
		}
		resubmitting = true;
		resubmitMsg = '';
		try {
			const attachments: AttachmentInput[] = [];
			for (const s of toUpload) {
				attachments.push(await uploadToInput(resubmitFiles[s]!, s));
			}
			await resubmitRequest(r.id, attachments);
			resubmitFiles = {};
			await refresh();
			detail = await getRequest(r.id);
			notify(translate($lang, 'resubmitSuccess'));
		} catch (e) {
			resubmitMsg = e instanceof Error ? e.message : String(e);
		} finally {
			resubmitting = false;
		}
	}

	function statusClass(status: string) {
		if (status === 'approved') return 'bg-green-50 text-green-700 ring-1 ring-green-200';
		if (status === 'rejected') return 'bg-red-50 text-red-700 ring-1 ring-red-200';
		if (status === 'revision_required') return 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200';
		return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200';
	}

	function revisionStateLabel(state: string) {
		if (state === 'needs_revision') return translate($lang, 'revisionStateNeedsRevision');
		if (state === 'resubmitted') return translate($lang, 'revisionStateResubmitted');
		if (state === 'approved') return translate($lang, 'approved');
		return translate($lang, 'revisionStateUnchanged');
	}

	function revisionStateClass(state: string) {
		if (state === 'needs_revision') return 'bg-red-50 text-red-700 ring-1 ring-red-200';
		if (state === 'resubmitted') return 'bg-blue-50 text-blue-700 ring-1 ring-blue-200';
		if (state === 'approved') return 'bg-green-50 text-green-700 ring-1 ring-green-200';
		return 'bg-ink-100 text-ink-600 ring-1 ring-ink-200';
	}

	function activityTitle(r: RequestItem) {
		if (r.activityName) return r.activityName;
		if (r.activity) {
			return $lang === 'th' ? r.activity.title : r.activity.titleEn;
		}
		return translate($lang, 'activity');
	}

	function statusLabel(r: RequestItem) {
		if (r.status === 'revision_required') return translate($lang, 'revisionRequired');
		return translate($lang, r.status as 'pending');
	}

	const inputClass =
		'w-full rounded-xl border border-ink-200 bg-ink-50 px-3.5 py-2.5 text-sm text-ink-900 transition focus:border-brand-500 focus:bg-surface focus:outline-none focus:ring-4 focus:ring-brand-100';
</script>

<div class="grid grid-cols-1 gap-8 xl:grid-cols-5">
	<div class="xl:col-span-2">
		<div>
			<h1 class="text-3xl font-extrabold tracking-tight text-ink-900">
				{translate($lang, 'myRequests')}
			</h1>
			<p class="mt-1 text-sm text-ink-500">{translate($lang, 'tagline')}</p>
		</div>

		{#if errorMsg}
			<div class="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
				{errorMsg}
			</div>
		{/if}
		{#if showSuccess}
			<SuccessCheck
				title={successText}
				description={translate($lang, 'requestWillReview')}
				onclose={closeSuccess}
			/>
		{/if}
		{#if $user && !$user.phone}
			<div
				class="mt-4 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
			>
				<CircleAlert size={16} class="shrink-0 text-amber-600" />
				<div class="flex flex-1 flex-wrap items-center justify-between gap-2">
					<span>{translate($lang, 'phoneMissingWarning')}</span>
					<a href="/profile" class="shrink-0 font-semibold text-amber-700 hover:underline">
						{translate($lang, 'profile')}
					</a>
				</div>
			</div>
		{/if}

		<!-- Submit form -->
		<div class="mt-4 rounded-3xl border border-ink-100 bg-surface p-6 shadow-soft xl:sticky xl:top-24">
			<div class="mb-5 flex items-center gap-2.5">
				<span class="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
					<FileText size={18} />
				</span>
				<h2 class="text-lg font-bold text-ink-900">{translate($lang, 'submitRequest')}</h2>
			</div>
			<form onsubmit={submit} class="space-y-4">
				<div class="grid grid-cols-2 gap-3 rounded-xl border border-ink-100 bg-ink-50/60 p-3.5 text-sm">
					<div>
						<div class="text-xs text-ink-400">{translate($lang, 'nameLabel')}</div>
						<div class="font-medium text-ink-800">{$user?.name ?? '-'}</div>
					</div>
					<div>
						<div class="text-xs text-ink-400">{translate($lang, 'studentId')}</div>
						<div class="font-medium text-ink-800">{$user?.studentId ?? '-'}</div>
					</div>
					<div class="col-span-2">
						<div class="text-xs text-ink-400">{translate($lang, 'major')}</div>
						<div class="font-medium text-ink-800">{$user?.faculty ?? '-'}</div>
					</div>
					<div>
						<div class="text-xs text-ink-400">{translate($lang, 'phone')}</div>
						<div class="font-medium text-ink-800">{$user?.phone ?? '-'}</div>
					</div>
					<div>
						<div class="text-xs text-ink-400">{translate($lang, 'date')}</div>
						<div class="font-medium text-ink-800">
							{currentDate?.toLocaleDateString($lang === 'th' ? 'th-TH' : 'en-US') ?? '-'}
						</div>
					</div>
				</div>

				<div>
					<label for="note" class="mb-1.5 block text-sm font-medium text-ink-700">
						{translate($lang, 'note')}
					</label>
					<textarea
						id="note"
						bind:value={note}
						rows={3}
						placeholder={translate($lang, 'description')}
						class={inputClass}
					></textarea>
				</div>

				<!-- Slot 1 (required) -->
				<div>
					<div class="mb-1.5 flex items-center justify-between">
						<label for="slot1" class="block text-sm font-medium text-ink-700">
							{translate($lang, 'slot1Evidence')} *
						</label>
						<span class="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-600">
							{translate($lang, 'requiredLabel')}
						</span>
					</div>
					<div
						class="flex items-center justify-center rounded-xl border-2 border-dashed border-ink-200 bg-ink-50/60 px-4 py-5 text-center transition hover:border-brand-300 hover:bg-brand-50/40"
					>
						<label for="slot1" class="flex w-full cursor-pointer flex-col items-center gap-1.5">
							<Upload size={20} class="text-brand-600" />
							{#if slot1File}
								<span class="line-clamp-1 max-w-full text-sm font-medium text-ink-800">
									<Paperclip size={13} class="mr-1 inline" />
									{slot1File.name}
								</span>
								<span class="text-xs text-ink-400">
									{slot1File.type} · {(slot1File.size / 1024).toFixed(0)} KB
								</span>
							{:else}
								<span class="text-sm text-ink-500">
									{translate($lang, 'uploadImages')}
								</span>
							{/if}
						</label>
					</div>
					<p class="mt-1.5 text-xs text-ink-400">{translate($lang, 'slot1Hint')}</p>
					<input
						id="slot1"
						type="file"
						accept="image/*,.pdf"
						onchange={(e) => (slot1File = e.currentTarget.files?.[0] ?? null)}
						class="sr-only"
					/>
				</div>

				<!-- Slot 2 (optional) -->
				<div>
					<div class="mb-1.5 flex items-center justify-between">
						<label for="slot2" class="block text-sm font-medium text-ink-700">
							{translate($lang, 'slot2Evidence')}
						</label>
						<span class="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-semibold text-ink-500">
							{translate($lang, 'optionalLabel')}
						</span>
					</div>
					<div
						class="flex items-center justify-center rounded-xl border-2 border-dashed border-ink-200 bg-ink-50/60 px-4 py-5 text-center transition hover:border-brand-300 hover:bg-brand-50/40"
					>
						<label for="slot2" class="flex w-full cursor-pointer flex-col items-center gap-1.5">
							<Upload size={20} class="text-brand-600" />
							{#if slot2File}
								<span class="line-clamp-1 max-w-full text-sm font-medium text-ink-800">
									<Paperclip size={13} class="mr-1 inline" />
									{slot2File.name}
								</span>
								<span class="text-xs text-ink-400">
									{slot2File.type} · {(slot2File.size / 1024).toFixed(0)} KB
								</span>
							{:else}
								<span class="text-sm text-ink-500">
									{translate($lang, 'uploadImages')} ({translate($lang, 'optionalLabel')})
								</span>
							{/if}
						</label>
					</div>
					<p class="mt-1.5 text-xs text-ink-400">{translate($lang, 'slot2Hint')}</p>
					<input
						id="slot2"
						type="file"
						accept="image/*,.pdf"
						onchange={(e) => (slot2File = e.currentTarget.files?.[0] ?? null)}
						class="sr-only"
					/>
				</div>

				<p class="text-sm text-ink-500">{translate($lang, 'requestNumberPending')}</p>

				<button
					type="submit"
					disabled={loading}
					class="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-2.5 font-medium text-white shadow-soft transition hover:bg-brand-700 disabled:opacity-50"
				>
					<Send size={17} />
					{loading ? translate($lang, 'submitting') : translate($lang, 'submitRequest')}
				</button>
			</form>
		</div>
	</div>

	<!-- Requests list -->
	<div class="space-y-4 xl:col-span-3">
		<div class="flex items-center justify-between">
			<h2 class="text-2xl font-bold text-ink-900">{translate($lang, 'allRequests')}</h2>
			<span class="rounded-full bg-ink-100 px-3 py-1 text-sm font-semibold text-ink-600">
				{requests.length}
			</span>
		</div>
		{#if requests.length === 0}
			<div class="rounded-2xl border border-dashed border-ink-200 bg-surface/60 px-6 py-10 text-center">
				<FileText size={28} class="mx-auto mb-2 text-ink-300" />
				<p class="text-sm text-ink-500">{translate($lang, 'noRequests')}</p>
			</div>
		{:else}
			{#each requests as r (r.id)}
				<div class="rounded-2xl border border-ink-100 bg-surface p-5 shadow-soft transition hover:shadow-lift">
					<button class="block w-full text-left" onclick={() => openDetail(r.id)}>
						<div class="flex items-start justify-between gap-4">
							<div class="min-w-0">
								<div class="flex items-center gap-2">
									<FileText size={16} class="shrink-0 text-brand-500" />
									<p class="truncate font-semibold text-ink-900">
										{activityTitle(r)}
									</p>
								</div>
								<p class="mt-1.5 flex items-center gap-1.5 text-sm text-ink-500">
									<CalendarDays size={14} />
									{new Date(r.activity?.date ?? r.submittedAt).toLocaleDateString($lang === 'th' ? 'th-TH' : 'en-US')}
								</p>
								{#if r.requestNumber}
									<p class="mt-1.5 text-sm text-ink-600">
										{translate($lang, 'requestNumber')}: {r.requestNumber}
									</p>
								{/if}
								{#if r.note}
									<p class="mt-2 text-sm text-ink-600">{r.note}</p>
								{/if}
							</div>
							<span
								class={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${statusClass(r.status)}`}
							>
								{#if r.status === 'approved'}
									<CircleCheck size={13} />
								{:else if r.status === 'rejected'}
									<CircleX size={13} />
								{:else if r.status === 'revision_required'}
									<RotateCcw size={13} />
								{:else}
									<Clock size={13} />
								{/if}
								{statusLabel(r)}
							</span>
						</div>
					</button>

					{#if r.status === 'rejected' && r.note}
						<p class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
							{translate($lang, 'reason')}: {r.note}
						</p>
					{/if}

					{#if r.status === 'revision_required'}
						<div class="mt-3 rounded-xl bg-indigo-50 px-3 py-2 text-sm text-indigo-700">
							<RotateCcw size={14} class="mr-1.5 inline" />
							{translate($lang, 'needResubmitSlots')}: {translate($lang, 'viewDetail')}
						</div>
					{/if}

					<div class="mt-3 flex items-center justify-between">
						<button
							onclick={() => openDetail(r.id)}
							class="inline-flex items-center gap-1 rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-semibold text-ink-700 transition hover:bg-ink-50"
						>
							<ChevronDown size={14} />
							{translate($lang, 'viewDetail')}
						</button>
						<button
							onclick={refresh}
							class="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-400 transition hover:bg-ink-50 hover:text-ink-600"
						>
							<RefreshCw size={13} />
						</button>
					</div>
				</div>
			{/each}
		{/if}
	</div>
</div>

{#if detailLoading || detail}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		onclick={(e) => { if (e.target === e.currentTarget) detail = null; }}
		onkeydown={(e) => { if (e.key === 'Escape') detail = null; }}
	>
		<div class="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-surface p-6 shadow-lift">
			{#if detailLoading}
				<div class="flex items-center gap-2 py-12 text-sm text-ink-500">
					<Clock size={16} class="animate-spin" />
					{translate($lang, 'submitting')}
				</div>
			{:else if detail}
				<div class="mb-4 flex items-start justify-between gap-3">
					<div>
						<h3 class="text-lg font-bold text-ink-900">
							{activityTitle(detail)}
						</h3>
						<span
							class={`mt-1 inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusClass(detail.status)}`}
						>
							{statusLabel(detail)}
						</span>
					</div>
					<button
						onclick={() => (detail = null)}
						class="rounded-lg p-1.5 text-ink-400 transition hover:bg-ink-50 hover:text-ink-700"
						aria-label={translate($lang, 'cancel')}
					>
						<CircleX size={18} />
					</button>
				</div>

				<div class="mb-5 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
					{#if detail.requestNumber}
						<div>
							<span class="text-ink-400">{translate($lang, 'requestNumber')}: </span>
							<span class="font-semibold text-ink-800">{detail.requestNumber}</span>
						</div>
					{/if}
					<div>
						<span class="text-ink-400">{translate($lang, 'submittedAt')}: </span>
						<span class="font-medium text-ink-800">
							{new Date(detail.submittedAt).toLocaleString($lang === 'th' ? 'th-TH' : 'en-US')}
						</span>
					</div>
					{#if detail.reviewedAt}
						<div>
							<span class="text-ink-400">{translate($lang, 'reviewedAt')}: </span>
							<span class="font-medium text-ink-800">
								{new Date(detail.reviewedAt).toLocaleString($lang === 'th' ? 'th-TH' : 'en-US')}
							</span>
						</div>
					{/if}
				</div>

				{#if detail.note}
					<div class="mb-5">
						<div class="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-400">
							{translate($lang, 'note')}
						</div>
						<p class="rounded-xl bg-ink-50 px-3.5 py-2.5 text-sm text-ink-700">{detail.note}</p>
					</div>
				{/if}

				<!-- Attachments with revision history -->
				<div class="mb-5">
					<div class="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">
						<Paperclip size={13} />
						{translate($lang, 'attachments')}
					</div>
					{#if !detail.attachments || detail.attachments.length === 0}
						<p class="text-sm text-ink-400">{translate($lang, 'noFiles')}</p>
					{:else}
						<div class="space-y-4">
							{#each detail.attachments as a (a.id)}
								{@const slotLabel = a.slot === 1 ? translate($lang, 'slot1Evidence') : a.slot === 2 ? translate($lang, 'slot2Evidence') : `${translate($lang, 'attachments')} ${a.slot ?? ''}`}
								{@const cur = currentRevision(a)}
								{@const slotsToFix = needsResubmitSlots(detail)}
								<div
									class="rounded-2xl border {a.slot === 1 ? 'border-ink-200' : 'border-dashed border-ink-200'} bg-ink-50/50 p-4"
								>
									<div class="mb-3 flex items-center justify-between gap-2">
										<span class="flex items-center gap-2 text-sm font-semibold text-ink-800">
											<span class="flex h-6 w-6 items-center justify-center rounded-lg bg-brand-50 text-xs font-bold text-brand-600">
												{a.slot ?? '-'}
											</span>
											{slotLabel}
											{#if a.slot === 1}
												<span class="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-600">
													{translate($lang, 'requiredLabel')}
												</span>
											{:else}
												<span class="rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-semibold text-ink-500">
													{translate($lang, 'optionalLabel')}
												</span>
											{/if}
										</span>
										{#if cur}
											<span
												class={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${revisionStateClass(cur.revisionState)}`}
											>
												{revisionStateLabel(cur.revisionState)}
											</span>
										{/if}
									</div>

									{#if cur}
										<a
											href={attachmentUrl(cur.storagePath)}
											target="_blank"
											rel="noopener noreferrer"
											class="flex items-center gap-2 rounded-xl bg-surface px-3 py-2 text-sm text-ink-700 ring-1 ring-ink-100 transition hover:text-brand-700"
										>
											<Paperclip size={14} class="shrink-0 text-ink-400" />
											<span class="line-clamp-1 flex-1">{cur.fileName}</span>
											<span class="text-xs text-ink-400">
												{translate($lang, 'currentFile')} · v{cur.revisionNumber}
											</span>
										</a>
									{/if}

									{#if (a.revisions?.length ?? 0) > 1}
										<div class="mt-2.5 border-t border-ink-100 pt-2.5">
											<div class="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
												{translate($lang, 'revisionHistory')}
											</div>
											<div class="space-y-1.5">
												{#each (a.revisions?.slice(1) ?? []) as rev, i}
													<a
														href={attachmentUrl(rev.storagePath)}
														target="_blank"
														rel="noopener noreferrer"
														class="flex items-center gap-2 px-2 py-1 text-xs text-ink-600 transition hover:text-brand-700"
													>
														<Clock size={12} class="shrink-0 text-ink-300" />
														<span class="line-clamp-1 flex-1">{rev.fileName}</span>
														<span
															class={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${revisionStateClass(rev.revisionState)}`}
														>
															{revisionStateLabel(rev.revisionState)}
														</span>
														<span class="text-ink-400">v{rev.revisionNumber}</span>
													</a>
												{/each}
											</div>
										</div>
									{/if}

									{#if detail.status === 'revision_required' && slotsToFix.includes(a.slot ?? -1)}
										<div class="mt-3 rounded-xl bg-red-50/70 px-3 py-2.5">
											<label for="resubmit-file-{a.slot}" class="flex cursor-pointer items-center gap-2 text-sm text-red-700">
												<Upload size={14} class="shrink-0 text-red-500" />
												{#if resubmitFiles[a.slot!]}
													<span class="line-clamp-1">{resubmitFiles[a.slot!]!.name}</span>
												{:else}
													<span>{translate($lang, 'resubmitSelected')} — {translate($lang, 'uploadImages')}</span>
												{/if}
											</label>
											<input
												id="resubmit-file-{a.slot}"
												type="file"
												accept="image/*,.pdf"
												class="sr-only"
												onchange={(e) => {
													const f = e.currentTarget.files?.[0] ?? null;
													if (f && a.slot != null) {
														resubmitFiles = { ...resubmitFiles, [a.slot]: f };
													}
												}}
											/>
										</div>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</div>

				{#if detail.status === 'revision_required'}
					{@const slotsToFix = needsResubmitSlots(detail)}
					<div class="border-t border-ink-100 pt-4">
						{#if slotsToFix.length === 0}
							<p class="text-sm text-ink-500">{translate($lang, 'resubmitEmpty')}</p>
						{:else}
							{#if resubmitMsg}
								<p class="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
									{resubmitMsg}
								</p>
							{/if}
							<button
								onclick={doResubmit}
								disabled={resubmitting || slotsToFix.some((s) => !resubmitFiles[s])}
								class="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-2.5 font-medium text-white shadow-soft transition hover:bg-brand-700 disabled:opacity-50"
							>
								<Send size={16} />
								{resubmitting ? translate($lang, 'submitting') : translate($lang, 'resubmit')}
							</button>
						{/if}
					</div>
				{/if}
			{/if}
		</div>
	</div>
{/if}
