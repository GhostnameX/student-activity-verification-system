<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { lang } from '$lib/store';
	import { user, loadSession } from '$lib/auth';
	import { translate } from '$lib/i18n';
	import { goto } from '$app/navigation';
	import {
		getSubmissionStats,
		getNotSubmitted,
		type SubmissionStats,
		type MajorSubmissionStats,
		type RosterStudent,
	} from '$lib/api';
	import {
		RefreshCw,
		Users,
		CircleCheck,
		CircleX,
		TrendingUp,
		LayoutDashboard,
		ChevronLeft,
		ChevronRight,
		Search,
		X,
		Clock,
		UserX,
	} from 'lucide-svelte';

	let stats = $state<SubmissionStats | null>(null);
	let loading: boolean = $state(true);
	let errorMsg: string = $state('');

	let modalOpen: boolean = $state(false);
	let modalLoading: boolean = $state(false);
	let filterMajor: string = $state('');
	let filterGroup: string = $state('');
	let search: string = $state('');
	let roster: RosterStudent[] = $state([]);
	let rosterTotal: number = $state(0);
	let rosterPage: number = $state(1);
	const pageSize = 20;
	let rosterReqId = 0;
	let searchTimer: ReturnType<typeof setTimeout> | undefined;

	onMount(async () => {
		await loadSession();
		if (!$user || ($user.role !== 'staff' && $user.role !== 'admin')) {
			goto('/auth/signin');
			return;
		}
		await refresh();
	});

	onDestroy(() => clearTimeout(searchTimer));

	async function refresh() {
		loading = true;
		errorMsg = '';
		try {
			stats = await getSubmissionStats();
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	function ratePct(rate: number) {
		return `${Math.round(rate * 100)}%`;
	}

	async function openModal(major?: string) {
		filterMajor = major ?? '';
		filterGroup = '';
		search = '';
		rosterPage = 1;
		modalOpen = true;
		await loadRoster();
	}

	async function loadRoster() {
		const reqId = ++rosterReqId;
		modalLoading = true;
		try {
			const res = await getNotSubmitted({
				major: filterMajor || undefined,
				group: filterGroup || undefined,
				search: search || undefined,
				page: rosterPage,
				pageSize,
			});
			if (reqId !== rosterReqId) return;
			roster = res.items;
			rosterTotal = res.total;
		} catch (e) {
			if (reqId !== rosterReqId) return;
			roster = [];
			rosterTotal = 0;
			errorMsg = e instanceof Error ? e.message : String(e);
		} finally {
			if (reqId === rosterReqId) modalLoading = false;
		}
	}

	function onSearchInput() {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			rosterPage = 1;
			loadRoster();
		}, 350);
	}

	function applySearch() {
		clearTimeout(searchTimer);
		rosterPage = 1;
		loadRoster();
	}

	function changeMajor() {
		filterGroup = '';
		rosterPage = 1;
		loadRoster();
	}

	function changeGroup() {
		rosterPage = 1;
		loadRoster();
	}

	async function goPage(p: number) {
		if (p < 1 || p > totalPages) return;
		rosterPage = p;
		await loadRoster();
	}

	let selectedMajor = $derived(
		stats?.byMajor.find((m) => m.major === filterMajor) ?? null,
	);

	let totalPages = $derived(Math.max(1, Math.ceil(rosterTotal / pageSize)));

	let isFiltered = $derived(filterMajor !== '' || filterGroup !== '' || search !== '');

	function fullName(s: RosterStudent) {
		return `${s.firstName} ${s.lastName}`;
	}
</script>

<div class="space-y-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="flex items-center gap-2 text-3xl font-extrabold tracking-tight text-ink-900">
				<LayoutDashboard size={26} class="text-brand-600" />
				{translate($lang, 'submissionStats')}
			</h1>
			<p class="mt-1 text-sm text-ink-500">
				{stats ? `${stats.total} ${translate($lang, 'studentsUnit')}` : translate($lang, 'stats')}
			</p>
		</div>
		<button
			onclick={refresh}
			class="flex items-center gap-1.5 rounded-xl border border-ink-200 bg-surface px-4 py-2 text-sm font-medium text-ink-700 shadow-soft transition hover:bg-ink-50"
		>
			<RefreshCw size={15} />
			{translate($lang, 'refresh')}
		</button>
	</div>

	{#if errorMsg}
		<div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
			{errorMsg}
		</div>
	{/if}

	{#if loading}
		<div class="flex items-center gap-2 py-12 text-sm text-ink-500">
			<Clock size={16} class="animate-spin" />
			{translate($lang, 'submitting')}
		</div>
	{:else if stats}
		<div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
			<div class="rounded-3xl border border-ink-100 bg-surface p-5 shadow-soft transition hover:shadow-lift">
				<div class="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-ink-500 to-ink-700 text-white shadow-soft">
					<Users size={19} />
				</div>
				<p class="text-sm text-ink-500">{translate($lang, 'eligibleStudents')}</p>
				<p class="mt-1 text-3xl font-extrabold tracking-tight text-ink-900">{stats.total}</p>
			</div>
			<div class="rounded-3xl border border-ink-100 bg-surface p-5 shadow-soft transition hover:shadow-lift">
				<div class="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-green-500 to-green-700 text-white shadow-soft">
					<CircleCheck size={19} />
				</div>
				<p class="text-sm text-ink-500">{translate($lang, 'submittedCount')}</p>
				<p class="mt-1 text-3xl font-extrabold tracking-tight text-ink-900">{stats.submitted}</p>
			</div>
			<div class="rounded-3xl border border-ink-100 bg-surface p-5 shadow-soft transition hover:shadow-lift">
				<div class="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow-soft">
					<UserX size={19} />
				</div>
				<p class="text-sm text-ink-500">{translate($lang, 'notSubmittedCount')}</p>
				<p class="mt-1 text-3xl font-extrabold tracking-tight text-ink-900">{stats.notSubmitted}</p>
			</div>
			<div class="rounded-3xl border border-ink-100 bg-surface p-5 shadow-soft transition hover:shadow-lift">
				<div class="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-soft">
					<TrendingUp size={19} />
				</div>
				<p class="text-sm text-ink-500">{translate($lang, 'submissionRate')}</p>
				<p class="mt-1 text-3xl font-extrabold tracking-tight text-ink-900">{ratePct(stats.rate)}</p>
			</div>
		</div>

		<div class="overflow-x-auto rounded-3xl border border-ink-100 bg-surface shadow-soft">
			<div class="flex items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
				<h2 class="flex items-center gap-2 text-lg font-bold text-ink-900">
					<Users size={18} class="text-brand-600" />
					{translate($lang, 'byMajor')}
				</h2>
				<button
					onclick={() => openModal()}
					class="flex items-center gap-1.5 rounded-xl bg-ink-900 px-4 py-2 text-sm font-semibold text-ink-50 shadow-soft transition hover:bg-ink-800"
				>
					<UserX size={15} />
					{translate($lang, 'viewNotSubmitted')}
				</button>
			</div>
			<table class="w-full text-left text-sm">
				<thead class="border-b border-ink-100 bg-ink-50/70 text-xs font-semibold uppercase tracking-wide text-ink-500">
					<tr>
						<th class="px-5 py-3.5">{translate($lang, 'major')}</th>
						<th class="px-5 py-3.5 text-right">{translate($lang, 'eligibleStudents')}</th>
						<th class="px-5 py-3.5 text-right">{translate($lang, 'submittedCount')}</th>
						<th class="px-5 py-3.5 text-right">{translate($lang, 'notSubmittedCount')}</th>
						<th class="px-5 py-3.5 text-right">{translate($lang, 'submissionRate')}</th>
						<th class="px-5 py-3.5 text-right">{translate($lang, 'actions')}</th>
					</tr>
				</thead>
				<tbody>
					{#each stats.byMajor as m (m.major)}
						<tr class="border-b border-ink-50 transition last:border-0 hover:bg-ink-50/50">
							<td class="px-5 py-4 font-medium text-ink-900">{m.major}</td>
							<td class="px-5 py-4 text-right text-ink-700">{m.total}</td>
							<td class="px-5 py-4 text-right text-green-600">{m.submitted}</td>
							<td class="px-5 py-4 text-right text-amber-600">{m.notSubmitted}</td>
							<td class="px-5 py-4 text-right text-ink-700">{ratePct(m.rate)}</td>
							<td class="px-5 py-4 text-right">
								{#if m.notSubmitted > 0}
									<button
										onclick={() => openModal(m.major)}
										class="inline-flex items-center gap-1 rounded-lg border border-ink-200 bg-surface px-3 py-1.5 text-xs font-semibold text-ink-700 transition hover:border-brand-300 hover:text-brand-700"
									>
										<Search size={13} />
										{translate($lang, 'viewNotSubmitted')}
									</button>
								{:else}
									<span class="text-xs text-ink-300">-</span>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

{#if modalOpen}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		onkeydown={(e) => { if (e.key === 'Escape') modalOpen = false; }}
	>
		<div class="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-surface shadow-lift">
			<div class="flex items-start justify-between gap-3 border-b border-ink-100 px-6 py-5">
				<div>
					<h3 class="flex items-center gap-2 text-lg font-bold text-ink-900">
						<UserX size={19} class="text-amber-500" />
						{translate($lang, 'notSubmittedCount')}
					</h3>
					<p class="mt-0.5 text-sm text-ink-500">
						{selectedMajor ? selectedMajor.major : translate($lang, 'allMajors')}
						&middot; {rosterTotal} {translate($lang, 'studentsUnit')}
					</p>
				</div>
				<button
					onclick={() => (modalOpen = false)}
					class="rounded-lg p-1.5 text-ink-400 transition hover:bg-ink-50 hover:text-ink-700"
					aria-label={translate($lang, 'cancel')}
				>
					<X size={18} />
				</button>
			</div>

			<div class="flex flex-wrap items-center gap-3 border-b border-ink-100 px-6 py-4">
				<div class="relative min-w-52 flex-1">
					<Search size={15} class="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
					<input
						bind:value={search}
						type="text"
						placeholder={translate($lang, 'searchPlaceholder')}
						oninput={onSearchInput}
						onkeydown={(e) => { if (e.key === 'Enter') applySearch(); }}
						class="w-full rounded-xl border border-ink-200 bg-ink-50 py-2 pl-9 pr-3.5 text-sm text-ink-900 transition focus:border-brand-500 focus:bg-surface focus:outline-none focus:ring-4 focus:ring-brand-100"
					/>
				</div>
				<select
					bind:value={filterMajor}
					onchange={changeMajor}
					class="rounded-xl border border-ink-200 bg-ink-50 px-3.5 py-2 text-sm text-ink-900 transition focus:border-brand-500 focus:bg-surface focus:outline-none focus:ring-4 focus:ring-brand-100"
				>
					<option value="">{translate($lang, 'allMajors')}</option>
					{#each stats?.byMajor ?? [] as m (m.major)}
						<option value={m.major}>{m.major}</option>
					{/each}
				</select>
				<select
					bind:value={filterGroup}
					onchange={changeGroup}
					class="rounded-xl border border-ink-200 bg-ink-50 px-3.5 py-2 text-sm text-ink-900 transition focus:border-brand-500 focus:bg-surface focus:outline-none focus:ring-4 focus:ring-brand-100"
				>
					<option value="">{translate($lang, 'allGroups')}</option>
					{#each selectedMajor?.groups ?? [] as g (g)}
						<option value={g}>{translate($lang, 'groupOf').replace('{group}', g)}</option>
					{/each}
				</select>
				<button
					onclick={applySearch}
					class="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-ink-50 shadow-soft transition hover:bg-brand-700"
				>
					{translate($lang, 'search')}
				</button>
			</div>

			<div class="flex-1 overflow-y-auto">
				{#if modalLoading}
					<div class="flex items-center gap-2 py-12 text-sm text-ink-500">
						<Clock size={16} class="animate-spin" />
						{translate($lang, 'submitting')}
					</div>
				{:else if roster.length === 0}
					<div class="px-6 py-12 text-center text-sm text-ink-500">
						{isFiltered ? translate($lang, 'noResults') : translate($lang, 'rosterEmpty')}
					</div>
				{:else}
					<div class="overflow-x-auto">
						<table class="w-full text-left text-sm">
							<thead class="sticky top-0 border-b border-ink-100 bg-ink-50/90 text-xs font-semibold uppercase tracking-wide text-ink-500 backdrop-blur">
								<tr>
									<th class="px-6 py-3">{translate($lang, 'studentId')}</th>
									<th class="px-6 py-3">{translate($lang, 'nameLabel')}</th>
									<th class="hidden px-6 py-3 md:table-cell">{translate($lang, 'major')}</th>
									<th class="hidden px-6 py-3 md:table-cell">{translate($lang, 'group')}</th>
									<th class="hidden px-6 py-3 lg:table-cell">{translate($lang, 'level')}</th>
								</tr>
							</thead>
							<tbody>
								{#each roster as s (s.studentId)}
									<tr class="border-b border-ink-50 last:border-0">
										<td class="whitespace-nowrap px-6 py-3 font-mono text-xs text-ink-600">{s.studentId}</td>
										<td class="px-6 py-3 font-medium text-ink-900">{fullName(s)}</td>
										<td class="hidden px-6 py-3 text-ink-600 md:table-cell">{s.major}</td>
										<td class="hidden px-6 py-3 text-ink-600 md:table-cell">
											<span class="rounded-full bg-ink-50 px-2.5 py-1 text-xs font-medium text-ink-600">
												{translate($lang, 'groupOf').replace('{group}', s.groupName)}
											</span>
										</td>
										<td class="hidden px-6 py-3 text-ink-600 lg:table-cell">{s.level}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>

			<div class="flex items-center justify-between gap-3 border-t border-ink-100 px-6 py-4">
				<p class="text-sm text-ink-500">
					{translate($lang, 'pageInfo').replace('{page}', String(rosterPage)).replace('{total}', String(totalPages))}
				</p>
				<div class="flex items-center gap-2">
					<button
						onclick={() => goPage(rosterPage - 1)}
						disabled={rosterPage <= 1}
						class="flex items-center gap-1 rounded-xl border border-ink-200 bg-surface px-3 py-2 text-sm font-medium text-ink-700 transition enabled:hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-40"
					>
						<ChevronLeft size={15} />
						{translate($lang, 'prev')}
					</button>
					<button
						onclick={() => goPage(rosterPage + 1)}
						disabled={rosterPage >= totalPages}
						class="flex items-center gap-1 rounded-xl border border-ink-200 bg-surface px-3 py-2 text-sm font-medium text-ink-700 transition enabled:hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-40"
					>
						{translate($lang, 'next')}
						<ChevronRight size={15} />
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
