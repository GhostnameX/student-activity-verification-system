<script lang="ts">
	import { onMount } from 'svelte';
	import { lang } from '$lib/store';
	import { user } from '$lib/auth';
	import { translate } from '$lib/i18n';
	import { goto } from '$app/navigation';
	import {
		getActivities,
		getRequests,
		createRequest,
		type Activity,
		type RequestItem,
	} from '$lib/api';
	import { uploadImageToSupabase } from '$lib/supabase';
	import {
		Send,
		FileText,
		CalendarDays,
		Paperclip,
		Upload,
		Clock,
		CircleCheck,
		CircleX,
	} from 'lucide-svelte';

	let activities: Activity[] = $state([]);
	let requests: RequestItem[] = $state([]);
	let selectedActivity: string = $state('');
	let note: string = $state('');
	let files: File[] = $state([]);
	let loading: boolean = $state(false);
	let errorMsg: string = $state('');
	let successMsg: string = $state('');

	onMount(async () => {
		if (!$user || $user.role !== 'student') {
			goto('/auth/signin');
			return;
		}
		activities = await getActivities();
		requests = await getRequests();
	});

	async function refresh() {
		requests = await getRequests();
	}

	async function submit() {
		loading = true;
		errorMsg = '';
		successMsg = '';
		try {
			const attachments = [];
			for (const file of files) {
				if (file.type.startsWith('image/')) {
					const path = `requests/${Date.now()}-${file.name}`;
					const storagePath = await uploadImageToSupabase(file, path);
					attachments.push({
						fileName: file.name,
						fileType: file.type,
						fileSize: file.size,
						storagePath,
					});
				} else {
					throw new Error('Only image files allowed');
				}
			}
			await createRequest({
				activityId: selectedActivity,
				note: note || undefined,
				attachments,
			});
			successMsg = translate($lang, 'requestSubmitted');
			note = '';
			files = [];
			selectedActivity = '';
			await refresh();
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	function statusClass(status: string) {
		if (status === 'approved') return 'bg-green-50 text-green-700 ring-1 ring-green-200';
		if (status === 'rejected') return 'bg-red-50 text-red-700 ring-1 ring-red-200';
		return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200';
	}

	function statusLabel(status: string) {
		return translate($lang, status as 'pending');
	}

	function activityTitle(r: RequestItem) {
		return r.activityName
			? r.activityName
			: $lang === 'th'
				? r.activity.title
				: r.activity.titleEn;
	}

	const inputClass =
		'w-full rounded-xl border border-ink-200 bg-ink-50 px-3.5 py-2.5 text-sm text-ink-900 transition focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-100';
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
		{#if successMsg}
			<div class="mt-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
				{successMsg}
			</div>
		{/if}

		<!-- Submit form -->
		<div class="mt-4 rounded-3xl border border-ink-100 bg-white p-6 shadow-soft xl:sticky xl:top-24">
		<div class="mb-5 flex items-center gap-2.5">
			<span class="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
				<FileText size={18} />
			</span>
			<h2 class="text-lg font-bold text-ink-900">{translate($lang, 'submitRequest')}</h2>
		</div>
		<form onsubmit={submit} class="space-y-4">
			<div>
				<label for="activity" class="mb-1.5 block text-sm font-medium text-ink-700">
					{translate($lang, 'activity')} *
				</label>
				<select id="activity" bind:value={selectedActivity} required class={inputClass}>
					<option value="">{translate($lang, 'selectActivity')}</option>
					{#each activities as a}
						<option value={a.id}>
							{$lang === 'th' ? a.title : a.titleEn}
						</option>
					{/each}
				</select>
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
			<div>
				<label for="files" class="mb-1.5 block text-sm font-medium text-ink-700">
					{translate($lang, 'uploadImages')}
				</label>
				<div
					class="flex items-center justify-center rounded-xl border-2 border-dashed border-ink-200 bg-ink-50/60 px-4 py-6 text-center transition hover:border-brand-300 hover:bg-brand-50/40"
				>
					<label for="files" class="flex cursor-pointer flex-col items-center gap-1.5">
						<Upload size={20} class="text-brand-600" />
						<span class="text-sm text-ink-500">
							{translate($lang, 'uploadImages')}
						</span>
						{#if files.length > 0}
							<span class="text-xs font-medium text-brand-600">
								{files.length} {translate($lang, 'attachments').toLowerCase()}
							</span>
						{/if}
					</label>
				</div>
				<input
					id="files"
					type="file"
					accept="image/*"
					multiple
					onchange={(e) => (files = Array.from(e.currentTarget.files ?? []))}
					class="sr-only"
				/>
			</div>
			<button
				type="submit"
				disabled={loading || !selectedActivity}
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
			<div class="rounded-2xl border border-dashed border-ink-200 bg-white/60 px-6 py-10 text-center">
				<FileText size={28} class="mx-auto mb-2 text-ink-300" />
				<p class="text-sm text-ink-500">{translate($lang, 'noRequests')}</p>
			</div>
		{:else}
			{#each requests as r (r.id)}
				<div class="rounded-2xl border border-ink-100 bg-white p-5 shadow-soft transition hover:shadow-lift">
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
								{new Date(r.activity.date).toLocaleDateString($lang === 'th' ? 'th-TH' : 'en-US')}
							</p>
							{#if r.note}
								<p class="mt-2 text-sm text-ink-600">{r.note}</p>
							{/if}
							{#if r.attachments && r.attachments.length > 0}
								<p class="mt-2 flex items-center gap-1.5 text-xs font-medium text-ink-400">
									<Paperclip size={13} />
									{r.attachments.length} {translate($lang, 'attachments').toLowerCase()}
								</p>
							{/if}
						</div>
						<span
							class={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${statusClass(r.status)}`}
						>
							{#if r.status === 'approved'}
								<CircleCheck size={13} />
							{:else if r.status === 'rejected'}
								<CircleX size={13} />
							{:else}
								<Clock size={13} />
							{/if}
							{statusLabel(r.status)}
						</span>
					</div>
					{#if r.status === 'rejected' && r.note}
						<p class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
							{translate($lang, 'reason')}: {r.note}
						</p>
					{/if}
				</div>
			{/each}
		{/if}
	</div>
</div>
