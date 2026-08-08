<script lang="ts">
	import { onMount } from 'svelte';
	import { lang } from '$lib/store';
	import { user } from '$lib/auth';
	import { translate } from '$lib/i18n';
	import { goto } from '$app/navigation';
	import { getRequests, type RequestItem } from '$lib/api';
	import {
		RefreshCw,
		FileText,
		Clock,
		CircleCheck,
		CircleX,
		LayoutDashboard,
	} from 'lucide-svelte';

	let requests: RequestItem[] = $state([]);
	let loading: boolean = $state(true);

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
			requests = await getRequests();
		} finally {
			loading = false;
		}
	}

	let total = $derived(requests.length);
	let approved = $derived(requests.filter((r) => r.status === 'approved').length);
	let rejected = $derived(requests.filter((r) => r.status === 'rejected').length);
	let pending = $derived(requests.filter((r) => r.status === 'pending').length);

	function statusClass(status: string) {
		if (status === 'approved') return 'bg-green-50 text-green-700 ring-1 ring-green-200';
		if (status === 'rejected') return 'bg-red-50 text-red-700 ring-1 ring-red-200';
		return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200';
	}

	const stats = $derived([
		{
			label: 'totalRequests',
			value: total,
			icon: FileText,
			classes: 'from-ink-500 to-ink-700',
		},
		{
			label: 'totalPending',
			value: pending,
			icon: Clock,
			classes: 'from-amber-400 to-amber-600',
		},
		{
			label: 'totalApproved',
			value: approved,
			icon: CircleCheck,
			classes: 'from-green-500 to-green-700',
		},
		{
			label: 'totalRejected',
			value: rejected,
			icon: CircleX,
			classes: 'from-red-500 to-red-700',
		},
	]);
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
		<button
			onclick={refresh}
			class="flex items-center gap-1.5 rounded-xl border border-ink-200 bg-white px-4 py-2 text-sm font-medium text-ink-700 shadow-soft transition hover:bg-ink-50"
		>
			<RefreshCw size={15} />
			{translate($lang, 'refresh')}
		</button>
	</div>

	<div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
		{#each stats as s (s.label)}
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

	{#if loading}
		<div class="flex items-center gap-2 py-12 text-sm text-ink-500">
			<Clock size={16} class="animate-spin" />
			{translate($lang, 'submitting')}
		</div>
	{:else if requests.length === 0}
		<div class="rounded-2xl border border-dashed border-ink-200 bg-white/60 px-6 py-12 text-center">
			<FileText size={30} class="mx-auto mb-2 text-ink-300" />
			<p class="text-sm text-ink-500">{translate($lang, 'noRequests')}</p>
		</div>
	{:else}
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
								{$lang === 'th' ? r.activity.title : r.activity.titleEn}
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
	{/if}
</div>
