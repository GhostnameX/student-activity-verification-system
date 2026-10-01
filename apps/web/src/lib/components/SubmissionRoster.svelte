<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { lang } from '$lib/store';
	import { translate } from '$lib/i18n';
	import { formatBangkokDate } from '$lib/datetime';
	import {
		getSubmissionList,
		NO_GROUP,
		type MajorSubmissionStats,
		type RosterStudent,
		type SubmissionState,
	} from '$lib/api';
	import RequestStatusBadge from './RequestStatusBadge.svelte';
	import { ChevronLeft, ChevronRight, Clock, RefreshCw, Search } from 'lucide-svelte';

	interface Props {
		view: SubmissionState;
		major: string;
		group: string;
		majors: MajorSubmissionStats[];
		/** Called when the user changes a filter; the parent owns the URL. */
		onchange: (patch: { view?: SubmissionState; major?: string; group?: string }) => void;
	}

	let { view, major, group, majors, onchange }: Props = $props();

	const pageSize = 20;
	let items: RosterStudent[] = $state([]);
	let total = $state(0);
	let page = $state(1);
	let search = $state('');
	let loading = $state(true);
	let error = $state('');
	let reqId = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;

	let selectedMajor = $derived(majors.find((m) => m.major === major) ?? null);
	let hasNoGroup = $derived(selectedMajor?.groupStats.some((g) => g.groupName === null) ?? false);
	let totalPages = $derived(Math.max(1, Math.ceil(total / pageSize)));

	async function load() {
		const id = ++reqId;
		loading = true;
		error = '';
		try {
			const res = await getSubmissionList(view, {
				major: major || undefined,
				group: group || undefined,
				search: search.trim() || undefined,
				page,
				pageSize,
			});
			if (id !== reqId) return;
			items = res.items;
			total = res.total;
		} catch (e) {
			if (id !== reqId) return;
			items = [];
			total = 0;
			error = e instanceof Error ? e.message : String(e);
		} finally {
			if (id === reqId) loading = false;
		}
	}

	// Reload whenever the filters from the URL change; go back to page 1.
	let lastKey = '';
	$effect(() => {
		const key = `${view}|${major}|${group}`;
		untrack(() => {
			if (key !== lastKey) {
				lastKey = key;
				page = 1;
			}
			void load();
		});
	});

	function onSearchInput() {
		clearTimeout(timer);
		timer = setTimeout(() => {
			page = 1;
			load();
		}, 350);
	}

	onDestroy(() => clearTimeout(timer));

	function goPage(p: number) {
		if (p < 1 || p > totalPages) return;
		page = p;
		load();
	}

	function groupText(g: string | null) {
		return g === null
			? translate($lang, 'ungroupedLabel')
			: translate($lang, 'groupOf').replace('{group}', g);
	}

	const selectClass =
		'min-h-11 rounded-xl border border-ink-200 bg-ink-50 px-3.5 py-2 text-sm text-ink-900 transition focus:border-brand-500 focus:bg-surface focus:outline-none focus:ring-4 focus:ring-brand-100';
</script>

<div class="space-y-4">
	<div class="flex flex-wrap items-center gap-2" role="group" aria-label={translate($lang, 'status')}>
		{#each ['not_submitted', 'submitted'] as const as s (s)}
			<button
				type="button"
				onclick={() => onchange({ view: s })}
				aria-pressed={view === s}
				class="min-h-11 rounded-full px-4 py-2 text-sm font-semibold transition {view === s
					? 'bg-brand-600 text-white shadow-soft'
					: 'border border-ink-200 bg-surface text-ink-600 hover:bg-ink-50'}"
			>
				{s === 'submitted'
					? translate($lang, 'submittedCount')
					: translate($lang, 'notSubmittedCount')}
			</button>
		{/each}
	</div>

	<div class="flex flex-wrap items-center gap-3">
		<div class="relative min-w-52 flex-1">
			<Search size={15} class="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
			<input
				bind:value={search}
				type="text"
				placeholder={translate($lang, 'searchPlaceholder')}
				aria-label={translate($lang, 'searchPlaceholder')}
				oninput={onSearchInput}
				class="min-h-11 w-full rounded-xl border border-ink-200 bg-ink-50 py-2 pl-9 pr-3.5 text-sm text-ink-900 transition focus:border-brand-500 focus:bg-surface focus:outline-none focus:ring-4 focus:ring-brand-100"
			/>
		</div>
		<select
			value={major}
			onchange={(e) => onchange({ major: e.currentTarget.value, group: '' })}
			aria-label={translate($lang, 'major')}
			class="{selectClass} min-w-0 max-w-full flex-1 sm:flex-none"
		>
			<option value="">{translate($lang, 'allMajors')}</option>
			{#each majors as m (m.major)}
				<option value={m.major}>{m.major}</option>
			{/each}
		</select>
		<select
			value={group}
			onchange={(e) => onchange({ group: e.currentTarget.value })}
			disabled={!selectedMajor}
			aria-label={translate($lang, 'group')}
			class="{selectClass} flex-1 disabled:opacity-50 sm:flex-none"
		>
			<option value="">{translate($lang, 'allGroups')}</option>
			{#each selectedMajor?.groups ?? [] as g (g)}
				<option value={g}>{groupText(g)}</option>
			{/each}
			{#if hasNoGroup}
				<option value={NO_GROUP}>{groupText(null)}</option>
			{/if}
		</select>
	</div>

	{#if error}
		<div
			class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
			role="alert"
		>
			<span>{error}</span>
			<button
				type="button"
				onclick={load}
				class="flex min-h-11 items-center gap-1.5 rounded-lg border border-red-200 bg-surface px-3 py-1.5 font-semibold"
			>
				<RefreshCw size={14} />
				{translate($lang, 'refresh')}
			</button>
		</div>
	{/if}

	<p class="text-sm text-ink-500" aria-live="polite">
		{total}
		{translate($lang, 'studentsUnit')}
	</p>

	{#if loading}
		<div class="flex items-center gap-2 py-10 text-sm text-ink-500">
			<Clock size={16} class="animate-spin" />
			{translate($lang, 'submitting')}
		</div>
	{:else if items.length === 0 && !error}
		<div class="rounded-2xl border border-dashed border-ink-200 bg-surface/60 px-6 py-10 text-center text-sm text-ink-500">
			{translate($lang, 'noResults')}
		</div>
	{:else}
		<!-- table from md up -->
		<div class="hidden overflow-x-auto rounded-2xl border border-ink-100 bg-surface shadow-soft md:block">
			<table class="w-full text-left text-sm">
				<thead class="border-b border-ink-100 bg-ink-50/70 text-xs font-semibold uppercase tracking-wide text-ink-500">
					<tr>
						<th class="px-5 py-3">{translate($lang, 'studentId')}</th>
						<th class="px-5 py-3">{translate($lang, 'nameLabel')}</th>
						<th class="px-5 py-3">{translate($lang, 'major')}</th>
						<th class="px-5 py-3">{translate($lang, 'group')}</th>
						<th class="px-5 py-3">{translate($lang, 'latestRequestStatus')}</th>
					</tr>
				</thead>
				<tbody>
					{#each items as s (s.studentId)}
						<tr class="border-b border-ink-50 last:border-0">
							<td class="whitespace-nowrap px-5 py-3 font-mono text-xs text-ink-600">{s.studentId}</td>
							<td class="px-5 py-3 font-medium text-ink-900">{s.firstName} {s.lastName}</td>
							<td class="px-5 py-3 text-ink-600">{s.major}</td>
							<td class="whitespace-nowrap px-5 py-3 text-ink-600">{groupText(s.groupName)}</td>
							<td class="px-5 py-3">
								{#if s.latestStatus}
									<div class="flex flex-wrap items-center gap-2">
										<RequestStatusBadge status={s.latestStatus} />
										{#if s.latestSubmittedAt}
											<span class="text-xs text-ink-400">
												{formatBangkokDate(s.latestSubmittedAt, $lang)}
											</span>
										{/if}
									</div>
								{:else}
									<span
										class="inline-flex whitespace-nowrap rounded-full bg-ink-50 px-3 py-1 text-xs font-semibold text-ink-600 ring-1 ring-ink-200"
									>
										{translate($lang, 'notSubmittedCount')}
									</span>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<!-- cards below md -->
		<ul class="space-y-2.5 md:hidden">
			{#each items as s (s.studentId)}
				<li class="rounded-2xl border border-ink-100 bg-surface p-4 shadow-soft">
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0">
							<div class="break-words font-semibold text-ink-900">{s.firstName} {s.lastName}</div>
							<div class="mt-0.5 font-mono text-xs text-ink-500">{s.studentId}</div>
						</div>
						{#if s.latestStatus}
							<RequestStatusBadge status={s.latestStatus} />
						{:else}
							<span
								class="inline-flex whitespace-nowrap rounded-full bg-ink-50 px-3 py-1 text-xs font-semibold text-ink-600 ring-1 ring-ink-200"
							>
								{translate($lang, 'notSubmittedCount')}
							</span>
						{/if}
					</div>
					<div class="mt-2 break-words text-xs text-ink-500">
						{s.major} · {groupText(s.groupName)}
					</div>
					{#if s.latestSubmittedAt}
						<div class="mt-1 text-xs text-ink-400">
							{translate($lang, 'latestSubmittedAt')}: {formatBangkokDate(s.latestSubmittedAt, $lang)}
						</div>
					{/if}
				</li>
			{/each}
		</ul>

		<div class="flex items-center justify-between gap-3">
			<p class="text-sm text-ink-500">
				{translate($lang, 'pageInfo').replace('{page}', String(page)).replace('{total}', String(totalPages))}
			</p>
			<div class="flex items-center gap-2">
				<button
					type="button"
					onclick={() => goPage(page - 1)}
					disabled={page <= 1}
					class="flex min-h-11 items-center gap-1 rounded-xl border border-ink-200 bg-surface px-3 py-2 text-sm font-medium text-ink-700 transition enabled:hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-40"
				>
					<ChevronLeft size={15} />
					{translate($lang, 'prev')}
				</button>
				<button
					type="button"
					onclick={() => goPage(page + 1)}
					disabled={page >= totalPages}
					class="flex min-h-11 items-center gap-1 rounded-xl border border-ink-200 bg-surface px-3 py-2 text-sm font-medium text-ink-700 transition enabled:hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-40"
				>
					{translate($lang, 'next')}
					<ChevronRight size={15} />
				</button>
			</div>
		</div>
	{/if}
</div>
