<script lang="ts">
	import { onMount } from 'svelte';
	import { lang } from '$lib/store';
	import { user } from '$lib/auth';
	import { translate } from '$lib/i18n';
	import { goto } from '$app/navigation';
	import { getRequests, getStats, getAuditLogs, type RequestItem, type StatsResponse, type AuditLogItem } from '$lib/api';
	import {
		RefreshCw,
		FileText,
		Clock,
		CircleCheck,
		CircleX,
		LayoutDashboard,
		ScrollText,
		Users,
		CalendarDays,
	} from 'lucide-svelte';

	let requests: RequestItem[] = $state([]);
	let stats = $state<StatsResponse | null>(null);
	let auditLogs: AuditLogItem[] = $state([]);
	let loading: boolean = $state(true);
	let activeTab: 'stats' | 'audit' = $state('stats');

	onMount(async () => {
		if (!$user || $user.role !== 'admin') {
			goto('/auth/signin');
			return;
		}
		await refresh();
	});

	async function refresh() {
		loading = true;
		try {
			const [req, st, audit] = await Promise.all([getRequests(), getStats(), getAuditLogs()]);
			requests = req;
			stats = st;
			auditLogs = audit;
		} finally {
			loading = false;
		}
	}

	function statusClass(status: string) {
		if (status === 'approved') return 'bg-green-50 text-green-700 ring-1 ring-green-200';
		if (status === 'rejected') return 'bg-red-50 text-red-700 ring-1 ring-red-200';
		return 'bg-accent-50 text-accent-700 ring-1 ring-accent-200';
	}

	const statCards = $derived([
		{
			label: 'totalRequests',
			value: stats?.total ?? 0,
			icon: FileText,
			classes: 'from-brand-600 to-brand-800',
		},
		{
			label: 'totalPending',
			value: stats?.pending ?? 0,
			icon: Clock,
			classes: 'from-accent-400 to-accent-600',
		},
		{
			label: 'totalApproved',
			value: stats?.approved ?? 0,
			icon: CircleCheck,
			classes: 'from-green-500 to-green-700',
		},
		{
			label: 'totalRejected',
			value: stats?.rejected ?? 0,
			icon: CircleX,
			classes: 'from-red-500 to-red-700',
		},
	]);

	function activityTitle(a: { title: string; titleEn: string }) {
		return $lang === 'th' ? a.title : a.titleEn;
	}

	function requestActivityTitle(r: {
		activity: { title: string; titleEn: string };
		activityName?: string | null;
	}) {
		return r.activityName ? r.activityName : activityTitle(r.activity);
	}

	function actionLabel(action: string) {
		const map: Record<string, string> = {
			approve: $lang === 'th' ? 'อนุมัติ' : 'Approve',
			reject: $lang === 'th' ? 'ไม่อนุมัติ' : 'Reject',
			activity_create: $lang === 'th' ? 'สร้างกิจกรรม' : 'Create activity',
			activity_update: $lang === 'th' ? 'แก้ไขกิจกรรม' : 'Update activity',
			activity_delete: $lang === 'th' ? 'ลบกิจกรรม' : 'Delete activity',
		};
		return map[action] ?? action;
	}
</script>

<div class="space-y-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="flex items-center gap-2 text-3xl font-extrabold tracking-tight text-ink-900">
				<LayoutDashboard size={26} class="text-brand-600" />
				{translate($lang, 'dashboard')}
			</h1>
			<p class="mt-1 text-sm text-ink-500">{translate($lang, 'stats')}</p>
		</div>
		<div class="flex items-center gap-2">
			<div class="flex items-center gap-1 rounded-2xl border border-ink-100 bg-white p-1 shadow-soft">
				<button
					onclick={() => (activeTab = 'stats')}
					class={`rounded-xl px-4 py-2 text-sm font-medium transition ${
						activeTab === 'stats' ? 'bg-brand-800 text-white shadow-soft' : 'text-ink-600 hover:bg-ink-50'
					}`}
				>
					{translate($lang, 'stats')}
				</button>
				<button
					onclick={() => (activeTab = 'audit')}
					class={`rounded-xl px-4 py-2 text-sm font-medium transition ${
						activeTab === 'audit' ? 'bg-brand-800 text-white shadow-soft' : 'text-ink-600 hover:bg-ink-50'
					}`}
				>
					{translate($lang, 'auditLog')}
				</button>
			</div>
			<button
				onclick={refresh}
				class="group flex items-center gap-1.5 rounded-xl border border-ink-200 bg-white px-4 py-2 text-sm font-medium text-ink-700 shadow-soft transition hover:bg-accent-50 hover:text-accent-700"
			>
				<RefreshCw size={15} class="transition group-hover:text-accent-500" />
				{translate($lang, 'refresh')}
			</button>
		</div>
	</div>

	{#if loading}
		<div class="flex items-center gap-2 py-12 text-sm text-ink-500">
			<Clock size={16} class="animate-spin" />
			{translate($lang, 'submitting')}
		</div>
	{:else if activeTab === 'stats'}
		<div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
			{#each statCards as s (s.label)}
				<div class="rounded-3xl border border-ink-100 bg-white p-5 shadow-soft transition hover:shadow-lift">
					<div
						class={`mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${s.classes} text-white shadow-soft`}
					>
						<s.icon size={19} />
					</div>
					<p class="text-sm text-ink-500">{translate($lang, s.label as 'stats')}</p>
					<p class="mt-1 text-3xl font-extrabold tracking-tight text-ink-900">{s.value}</p>
				</div>
			{/each}
		</div>

		<div class="grid gap-6 lg:grid-cols-2">
			<div class="rounded-3xl border border-ink-100 bg-white p-6 shadow-soft">
				<h2 class="mb-4 flex items-center gap-2 text-lg font-bold text-ink-900">
					<CalendarDays size={18} class="text-brand-600" />
					{translate($lang, 'byActivity')}
				</h2>
				{#if stats && stats.byActivity.length === 0}
					<p class="text-sm text-ink-500">{translate($lang, 'noRequests')}</p>
				{:else}
					<div class="overflow-x-auto">
						<table class="w-full text-left text-sm">
							<thead class="border-b border-ink-100 text-xs font-semibold uppercase tracking-wide text-ink-500">
								<tr>
									<th class="px-3 py-2">{translate($lang, 'activity')}</th>
									<th class="px-3 py-2 text-right">{translate($lang, 'totalRequests')}</th>
									<th class="px-3 py-2 text-right">{translate($lang, 'totalPending')}</th>
									<th class="px-3 py-2 text-right">{translate($lang, 'totalApproved')}</th>
									<th class="px-3 py-2 text-right">{translate($lang, 'totalRejected')}</th>
								</tr>
							</thead>
							<tbody>
								{#each stats!.byActivity as a (a.id)}
									<tr class="border-b border-ink-50 last:border-0">
										<td class="px-3 py-2.5 font-medium text-ink-900">{activityTitle(a)}</td>
										<td class="px-3 py-2.5 text-right text-ink-700">{a.total}</td>
										<td class="px-3 py-2.5 text-right text-accent-600">{a.pending}</td>
										<td class="px-3 py-2.5 text-right text-green-600">{a.approved}</td>
										<td class="px-3 py-2.5 text-right text-red-600">{a.rejected}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>

			<div class="rounded-3xl border border-ink-100 bg-white p-6 shadow-soft">
				<h2 class="mb-4 flex items-center gap-2 text-lg font-bold text-ink-900">
					<Users size={18} class="text-brand-600" />
					{translate($lang, 'byFaculty')}
				</h2>
				{#if stats && stats.byFaculty.length === 0}
					<p class="text-sm text-ink-500">{translate($lang, 'noRequests')}</p>
				{:else}
					<div class="overflow-x-auto">
						<table class="w-full text-left text-sm">
							<thead class="border-b border-ink-100 text-xs font-semibold uppercase tracking-wide text-ink-500">
								<tr>
									<th class="px-3 py-2">{translate($lang, 'faculty')}</th>
									<th class="px-3 py-2 text-right">{translate($lang, 'totalRequests')}</th>
									<th class="px-3 py-2 text-right">{translate($lang, 'totalPending')}</th>
									<th class="px-3 py-2 text-right">{translate($lang, 'totalApproved')}</th>
									<th class="px-3 py-2 text-right">{translate($lang, 'totalRejected')}</th>
								</tr>
							</thead>
							<tbody>
								{#each stats!.byFaculty as f (f.faculty)}
									<tr class="border-b border-ink-50 last:border-0">
										<td class="px-3 py-2.5 font-medium text-ink-900">{f.faculty}</td>
										<td class="px-3 py-2.5 text-right text-ink-700">{f.total}</td>
										<td class="px-3 py-2.5 text-right text-accent-600">{f.pending}</td>
										<td class="px-3 py-2.5 text-right text-green-600">{f.approved}</td>
										<td class="px-3 py-2.5 text-right text-red-600">{f.rejected}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>
		</div>

		<div class="overflow-x-auto rounded-3xl border border-ink-100 bg-white shadow-soft">
			<table class="w-full text-left text-sm">
				<thead class="border-b border-ink-100 bg-ink-50/70 text-xs font-semibold uppercase tracking-wide text-ink-500">
					<tr>
						<th class="px-5 py-3.5">{translate($lang, 'activity')}</th>
						<th class="px-5 py-3.5">{translate($lang, 'student')}</th>
						<th class="hidden px-5 py-3.5 lg:table-cell">{translate($lang, 'studentId')}</th>
						<th class="hidden px-5 py-3.5 md:table-cell">{translate($lang, 'faculty')}</th>
						<th class="hidden px-5 py-3.5 lg:table-cell">{translate($lang, 'submittedAt')}</th>
						<th class="px-5 py-3.5">{translate($lang, 'status')}</th>
					</tr>
				</thead>
				<tbody>
					{#each requests as r (r.id)}
						<tr class="border-b border-ink-50 transition last:border-0 hover:bg-ink-50/50">
							<td class="px-5 py-4 font-medium text-ink-900">
								{requestActivityTitle(r)}
							</td>
							<td class="px-5 py-4 font-medium text-ink-800">{r.student?.name}</td>
							<td class="hidden px-5 py-4 text-ink-600 lg:table-cell">
								{r.student?.studentId ?? '-'}
							</td>
							<td class="hidden px-5 py-4 text-ink-600 md:table-cell">
								{r.student?.faculty ?? '-'}
							</td>
							<td class="hidden px-5 py-4 text-ink-600 lg:table-cell">
								{new Date(r.submittedAt).toLocaleString($lang === 'th' ? 'th-TH' : 'en-US')}
							</td>
							<td class="px-5 py-4">
								<span
									class={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusClass(r.status)}`}
								>
									{translate($lang, r.status as 'pending')}
								</span>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<div class="rounded-3xl border border-ink-100 bg-white p-6 shadow-soft">
			<h2 class="mb-4 flex items-center gap-2 text-lg font-bold text-ink-900">
				<ScrollText size={18} class="text-brand-600" />
				{translate($lang, 'auditLog')}
			</h2>
			{#if auditLogs.length === 0}
				<p class="text-sm text-ink-500">{translate($lang, 'noAuditLogs')}</p>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full text-left text-sm">
						<thead class="border-b border-ink-100 text-xs font-semibold uppercase tracking-wide text-ink-500">
							<tr>
								<th class="px-3 py-2">{translate($lang, 'createdAt')}</th>
								<th class="px-3 py-2">{translate($lang, 'actor')}</th>
								<th class="px-3 py-2">{translate($lang, 'action')}</th>
								<th class="px-3 py-2">{translate($lang, 'target')}</th>
							</tr>
						</thead>
						<tbody>
							{#each auditLogs as log (log.id)}
								<tr class="border-b border-ink-50 last:border-0">
									<td class="px-3 py-2.5 whitespace-nowrap text-ink-600">
										{new Date(log.createdAt).toLocaleString($lang === 'th' ? 'th-TH' : 'en-US')}
									</td>
									<td class="px-3 py-2.5 text-ink-700">{log.actorId ? log.actorId.slice(0, 8) : '-'}</td>
									<td class="px-3 py-2.5 font-medium text-ink-900">{actionLabel(log.action)}</td>
									<td class="px-3 py-2.5 text-ink-600">
										<span class="rounded-full bg-ink-50 px-2.5 py-1 text-xs font-medium text-ink-600">
											{log.targetType}
										</span>
										<span class="ml-2 font-mono text-xs text-ink-400">{log.targetId.slice(0, 8)}</span>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>
	{/if}
</div>
