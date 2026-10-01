<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { lang } from '$lib/store';
	import { user, loadSession } from '$lib/auth';
	import { translate } from '$lib/i18n';
	import {
		getSubmissionStats,
		NO_GROUP,
		type SubmissionState,
		type SubmissionStats,
	} from '$lib/api';
	import HorizontalBarChart, { type BarItem } from '$lib/components/HorizontalBarChart.svelte';
	import SubmissionRoster from '$lib/components/SubmissionRoster.svelte';
	import StatCard from '$lib/components/StatCard.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Button from '$lib/components/Button.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import {
		RefreshCw,
		Users,
		CircleCheck,
		TrendingUp,
		LayoutDashboard,
		ChevronRight,
		Clock,
		UserX,
	} from 'lucide-svelte';

	let stats = $state<SubmissionStats | null>(null);
	let loading: boolean = $state(true);
	let errorMsg: string = $state('');

	// Navigation state lives in the URL so the browser back button works:
	//   /stats                      level 1: bars per major
	//   /stats?major=M              level 2: bars per group of M
	//   /stats?major=M&group=G      level 3: student list (G may be the "no group" key)
	//   /stats?state=submitted      student list from a card (any major), filters adjustable
	let major = $derived(page.url.searchParams.get('major') ?? '');
	let group = $derived(page.url.searchParams.get('group') ?? '');
	let listState = $derived<SubmissionState | ''>(
		page.url.searchParams.get('state') === 'submitted'
			? 'submitted'
			: page.url.searchParams.get('state') === 'not_submitted'
				? 'not_submitted'
				: '',
	);
	let showRoster = $derived(group !== '' || listState !== '');
	let selectedMajor = $derived(stats?.byMajor.find((m) => m.major === major) ?? null);

	onMount(async () => {
		await loadSession();
		if (!$user || ($user.role !== 'staff' && $user.role !== 'admin')) {
			goto('/auth/signin');
			return;
		}
		await refresh();
	});

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

	function navigate(params: { major?: string; group?: string; state?: string }) {
		const q = new URLSearchParams();
		if (params.major) q.set('major', params.major);
		if (params.group) q.set('group', params.group);
		if (params.state) q.set('state', params.state);
		const qs = q.toString();
		goto(`/stats${qs ? `?${qs}` : ''}`, { noScroll: true, keepFocus: true });
	}

	function onRosterChange(patch: { view?: SubmissionState; major?: string; group?: string }) {
		navigate({
			major: patch.major ?? major,
			group: patch.group ?? group,
			state: patch.view ?? (listState || 'not_submitted'),
		});
	}

	function groupText(g: string | null) {
		return g === null
			? translate($lang, 'ungroupedLabel')
			: translate($lang, 'groupOf').replace('{group}', g);
	}

	function valueText(item: BarItem, pct: number) {
		return translate($lang, 'submittedOfTotal')
			.replace('{submitted}', String(item.value))
			.replace('{total}', String(item.total))
			.replace('{pct}', String(pct));
	}

	let majorBars = $derived<BarItem[]>(
		(stats?.byMajor ?? []).map((m) => ({
			key: m.major,
			label: m.major,
			value: m.submitted,
			total: m.total,
		})),
	);
	let groupBars = $derived<BarItem[]>(
		(selectedMajor?.groupStats ?? []).map((g) => ({
			key: g.groupName ?? NO_GROUP,
			label: groupText(g.groupName),
			value: g.submitted,
			total: g.total,
		})),
	);

	function ratePct(rate: number) {
		return `${Math.round(rate * 100)}%`;
	}

	let crumbGroupLabel = $derived(
		group === NO_GROUP ? groupText(null) : group ? groupText(group) : '',
	);
	let level = $derived(showRoster ? 3 : major ? 2 : 1);

</script>

<div class="space-y-6">
	<PageHeader
		title={translate($lang, 'submissionStats')}
		subtitle={stats ? `${stats.total} ${translate($lang, 'studentsUnit')}` : translate($lang, 'stats')}
		icon={LayoutDashboard}
	>
		{#snippet actions()}
			<Button onclick={refresh}>
				<RefreshCw size={15} aria-hidden="true" />
				{translate($lang, 'refresh')}
			</Button>
		{/snippet}
	</PageHeader>

	{#if errorMsg}
		<div
			class="flex flex-wrap items-center justify-between gap-3 rounded-control border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
			role="alert"
		>
			<span>{errorMsg}</span>
			<button
				onclick={refresh}
				class="flex min-h-11 items-center gap-1.5 rounded-lg border border-red-200 bg-surface px-3 py-1.5 font-semibold"
			>
				<RefreshCw size={14} />
				{translate($lang, 'refresh')}
			</button>
		</div>
	{/if}

	{#if loading}
		<div class="flex items-center gap-2 py-12 text-sm text-ink-500">
			<Clock size={16} class="animate-spin" />
			{translate($lang, 'submitting')}
		</div>
	{:else if stats}
		<div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
			<StatCard
				label={translate($lang, 'eligibleStudents')}
				value={stats.total}
				icon={Users}
				tone="ink"
				onclick={() => navigate({})}
			/>
			<StatCard
				label={translate($lang, 'submittedCount')}
				value={stats.submitted}
				icon={CircleCheck}
				tone="green"
				ariaLabel="{translate($lang, 'viewSubmitted')}: {stats.submitted}"
				onclick={() => navigate({ state: 'submitted' })}
			/>
			<StatCard
				label={translate($lang, 'notSubmittedCount')}
				value={stats.notSubmitted}
				icon={UserX}
				tone="amber"
				ariaLabel="{translate($lang, 'viewNotSubmitted')}: {stats.notSubmitted}"
				onclick={() => navigate({ state: 'not_submitted' })}
			/>
			<StatCard
				label={translate($lang, 'submissionRate')}
				value={ratePct(stats.rate)}
				icon={TrendingUp}
				tone="brand"
			/>
		</div>

		{#if level > 1}
			<nav aria-label={translate($lang, 'breadcrumbLabel')}>
				<ol class="flex flex-wrap items-center gap-1.5 text-sm">
					<li>
						<button
							type="button"
							onclick={() => navigate({})}
							class="min-h-11 rounded-lg px-2 font-medium text-brand-700 hover:bg-brand-50"
						>
							{translate($lang, 'allMajors')}
						</button>
					</li>
					{#if major}
						<li aria-hidden="true"><ChevronRight size={14} class="text-ink-400" /></li>
						<li>
							{#if group}
								<button
									type="button"
									onclick={() => navigate({ major })}
									class="min-h-11 rounded-lg px-2 text-left font-medium text-brand-700 hover:bg-brand-50"
								>
									{major}
								</button>
							{:else}
								<span class="break-words px-2 font-semibold text-ink-900" aria-current="page">{major}</span>
							{/if}
						</li>
					{/if}
					{#if group}
						<li aria-hidden="true"><ChevronRight size={14} class="text-ink-400" /></li>
						<li>
							<span class="px-2 font-semibold text-ink-900" aria-current="page">{crumbGroupLabel}</span>
						</li>
					{:else if showRoster}
						<li aria-hidden="true"><ChevronRight size={14} class="text-ink-400" /></li>
						<li>
							<span class="px-2 font-semibold text-ink-900" aria-current="page">
								{translate($lang, 'rosterTitle')}
							</span>
						</li>
					{/if}
				</ol>
			</nav>
		{/if}

		{#if showRoster}
			<SubmissionRoster
				view={listState || 'not_submitted'}
				{major}
				{group}
				majors={stats.byMajor}
				onchange={onRosterChange}
			/>
		{:else if major && !selectedMajor}
			<EmptyState message={translate($lang, 'noResults')} />
		{:else}
			<section class="space-y-3">
				<div>
					<h2 class="flex items-center gap-2 text-lg font-bold text-ink-900">
						<Users size={18} class="text-brand-600" />
						{major ? translate($lang, 'chartGroupTitle') : translate($lang, 'chartMajorTitle')}
					</h2>
					<p class="mt-0.5 text-sm text-ink-500">
						{major ? translate($lang, 'chartGroupHint') : translate($lang, 'chartMajorHint')}
					</p>
				</div>
				{#if (major ? groupBars : majorBars).length === 0}
					<EmptyState message={translate($lang, 'noResults')} />
				{:else if major}
					<HorizontalBarChart
						items={groupBars}
						{valueText}
						ariaLabel={translate($lang, 'chartGroupTitle')}
						onselect={(key) => navigate({ major, group: key, state: 'not_submitted' })}
					/>
				{:else}
					<HorizontalBarChart
						items={majorBars}
						{valueText}
						ariaLabel={translate($lang, 'chartMajorTitle')}
						onselect={(key) => navigate({ major: key })}
					/>
				{/if}
			</section>
		{/if}
	{/if}
</div>
