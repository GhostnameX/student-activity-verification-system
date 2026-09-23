<script lang="ts">
	import { onMount } from 'svelte';
	import { lang } from '$lib/store';
	import { user, loadSession } from '$lib/auth';
	import { translate } from '$lib/i18n';
	import { goto } from '$app/navigation';
	import {
		getRequests,
		getStats,
		getAuditLogs,
		getActivities,
		createActivity,
		updateActivity,
		deleteActivity,
		getStaffList,
		createStaff,
		updateStaff,
		type RequestItem,
		type StatsResponse,
		type AuditLogItem,
		type Activity,
		type ActivityInput,
		type StaffMember,
		type StaffInput,
	} from '$lib/api';
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
		Plus,
		Pencil,
		Trash2,
		CalendarPlus,
		UserPlus,
		KeyRound,
		Power,
	} from 'lucide-svelte';

	let requests: RequestItem[] = $state([]);
	let stats = $state<StatsResponse | null>(null);
	let auditLogs: AuditLogItem[] = $state([]);
	let activities: Activity[] = $state([]);
	let loading: boolean = $state(true);
	let activeTab: 'stats' | 'audit' | 'activities' | 'staff' = $state('stats');
	let activityModal: 'add' | 'edit' | null = $state(null);
	let editingId: string | null = $state(null);
	let deleteTarget: Activity | null = $state(null);
	let savingActivity: boolean = $state(false);
	let activityMsg: string = $state('');
	let activityForm = $state<ActivityInput & { dateStr: string; deadlineStr: string }>(emptyActivityForm());
	let staffList: StaffMember[] = $state([]);
	let staffModal: 'add' | 'edit' | null = $state(null);
	let editingStaffId: string | null = $state(null);
	let staffMsg: string = $state('');
	let savingStaff: boolean = $state(false);
	let staffForm = $state<StaffInput & { isActive: boolean }>(emptyStaffForm());

	function emptyStaffForm() {
		return {
			email: '',
			staffCode: '',
			fullName: '',
			password: '',
			role: 'staff' as const,
			kind: 'main' as const,
			isActive: true,
		};
	}

	function emptyActivityForm() {
		const today = new Date().toISOString().slice(0, 10);
		return {
			title: '',
			titleEn: '',
			type: '',
			organizer: '',
			date: '',
			dateStr: today,
			location: '',
			description: '',
			descriptionEn: '',
			submissionDeadline: '',
			deadlineStr: '',
			isActive: true,
		};
	}

	onMount(async () => {
		await loadSession();
		if (!$user || $user.role !== 'admin') {
			goto('/auth/signin');
			return;
		}
		await refresh();
	});

	async function refresh() {
		loading = true;
		try {
			const [req, st, audit, acts, staffRows] = await Promise.all([
				getRequests(),
				getStats(),
				getAuditLogs(),
				getActivities(true),
				getStaffList(),
			]);
			requests = req;
			stats = st;
			auditLogs = audit;
			activities = acts;
			staffList = staffRows;
		} finally {
			loading = false;
		}
	}

	function openAddActivity() {
		activityForm = emptyActivityForm();
		editingId = null;
		activityMsg = '';
		activityModal = 'add';
	}

	function openEditActivity(a: Activity) {
		activityForm = {
			title: a.title,
			titleEn: a.titleEn,
			type: a.type,
			organizer: a.organizer,
			date: a.date,
			dateStr: new Date(a.date).toISOString().slice(0, 10),
			location: a.location,
			description: a.description ?? '',
			descriptionEn: a.descriptionEn ?? '',
			submissionDeadline: a.submissionDeadline ?? '',
			deadlineStr: a.submissionDeadline ? new Date(a.submissionDeadline).toISOString().slice(0, 16) : '',
			isActive: a.isActive ?? true,
		};
		editingId = a.id;
		activityMsg = '';
		activityModal = 'edit';
	}

	function closeActivityModal() {
		activityModal = null;
		editingId = null;
		activityMsg = '';
	}

	async function saveActivity() {
		savingActivity = true;
		activityMsg = '';
		try {
			const payload: ActivityInput = {
				title: activityForm.title.trim(),
				titleEn: activityForm.titleEn.trim(),
				type: activityForm.type.trim(),
				organizer: activityForm.organizer.trim(),
				date: activityForm.dateStr ? new Date(activityForm.dateStr + 'T00:00:00').toISOString() : activityForm.date,
				location: activityForm.location.trim(),
				description: activityForm.description || null,
				descriptionEn: activityForm.descriptionEn || null,
				submissionDeadline: activityForm.deadlineStr ? new Date(activityForm.deadlineStr).toISOString() : null,
				isActive: activityForm.isActive,
			};
			if (activityModal === 'edit' && editingId) {
				await updateActivity(editingId, payload);
			} else {
				await createActivity(payload);
			}
			closeActivityModal();
			await refresh();
		} catch (e) {
			activityMsg = e instanceof Error ? e.message : String(e);
		} finally {
			savingActivity = false;
		}
	}

	async function removeActivity() {
		if (!deleteTarget) return;
		try {
			await deleteActivity(deleteTarget.id);
			deleteTarget = null;
			await refresh();
		} catch (e) {
			activityMsg = e instanceof Error ? e.message : String(e);
			deleteTarget = null;
		}
	}

	function activityDateStr(d: string) {
		return new Date(d).toLocaleDateString($lang === 'th' ? 'th-TH' : 'en-US');
	}

	function statusClass(status: string) {
		if (status === 'approved') return 'bg-green-50 text-green-700 ring-1 ring-green-200';
		if (status === 'rejected') return 'bg-red-50 text-red-700 ring-1 ring-red-200';
		return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200';
	}

	const statCards = $derived([
		{
			label: 'totalRequests',
			value: stats?.total ?? 0,
			icon: FileText,
			classes: 'from-ink-500 to-ink-700',
		},
		{
			label: 'totalPending',
			value: stats?.pending ?? 0,
			icon: Clock,
			classes: 'from-amber-400 to-amber-600',
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
		activity: { title: string; titleEn: string } | null;
		activityName?: string | null;
	}) {
		if (r.activityName) return r.activityName;
		if (r.activity) return activityTitle(r.activity);
		return translate($lang, 'activity');
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

	function openAddStaff() {
		staffForm = emptyStaffForm();
		editingStaffId = null;
		staffMsg = '';
		staffModal = 'add';
	}

	function openEditStaff(s: StaffMember) {
		staffForm = {
			email: s.email,
			staffCode: s.staffCode,
			fullName: s.fullName,
			password: '',
			role: s.role === 'admin' ? 'admin' : 'staff',
			kind: s.kind === 'emergency' ? 'emergency' : 'main',
			isActive: s.isActive,
		};
		editingStaffId = s.id;
		staffMsg = '';
		staffModal = 'edit';
	}

	function closeStaffModal() {
		staffModal = null;
		editingStaffId = null;
		staffMsg = '';
	}

	async function saveStaff() {
		savingStaff = true;
		staffMsg = '';
		try {
			const payload: StaffInput = {
				email: staffForm.email?.trim() || undefined,
				staffCode: staffForm.staffCode.trim(),
				fullName: staffForm.fullName.trim(),
				role: staffForm.role,
				kind: staffForm.kind,
				isActive: staffForm.isActive,
			};
			if (staffForm.password) payload.password = staffForm.password;
			if (staffModal === 'edit' && editingStaffId) {
				await updateStaff(editingStaffId, payload);
			} else {
				await createStaff(payload);
			}
			closeStaffModal();
			await refresh();
		} catch (e) {
			const err = e instanceof Error ? e.message : String(e);
			if (err === 'staff_code_taken') staffMsg = translate($lang, 'staffCodeTaken');
			else if (err === 'password_too_short') staffMsg = translate($lang, 'passwordTooShort');
			else if (err === 'cannot_disable_self') staffMsg = translate($lang, 'cannotDisableSelf');
			else staffMsg = translate($lang, 'staffError');
		} finally {
			savingStaff = false;
		}
	}

	async function toggleStaffActive(s: StaffMember) {
		staffMsg = '';
		try {
			await updateStaff(s.id, { isActive: !s.isActive });
			await refresh();
		} catch (e) {
			const err = e instanceof Error ? e.message : String(e);
			if (err === 'cannot_disable_self') staffMsg = translate($lang, 'cannotDisableSelf');
			else staffMsg = translate($lang, 'staffError');
		}
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
			<div class="flex items-center gap-1 rounded-2xl border border-ink-100 bg-surface p-1 shadow-soft">
				<button
					onclick={() => (activeTab = 'stats')}
					class={`rounded-xl px-4 py-2 text-sm font-medium transition ${
						activeTab === 'stats' ? 'bg-ink-900 text-ink-50 shadow-soft' : 'text-ink-600 hover:bg-ink-50'
					}`}
				>
					{translate($lang, 'stats')}
				</button>
				<button
					onclick={() => (activeTab = 'audit')}
					class={`rounded-xl px-4 py-2 text-sm font-medium transition ${
						activeTab === 'audit' ? 'bg-ink-900 text-ink-50 shadow-soft' : 'text-ink-600 hover:bg-ink-50'
					}`}
				>
					{translate($lang, 'auditLog')}
				</button>
				<button
					onclick={() => (activeTab = 'activities')}
					class={`rounded-xl px-4 py-2 text-sm font-medium transition ${
						activeTab === 'activities' ? 'bg-ink-900 text-ink-50 shadow-soft' : 'text-ink-600 hover:bg-ink-50'
					}`}
				>
					{translate($lang, 'activities')}
				</button>
				<button
					onclick={() => (activeTab = 'staff')}
					class={`rounded-xl px-4 py-2 text-sm font-medium transition ${
						activeTab === 'staff' ? 'bg-ink-900 text-ink-50 shadow-soft' : 'text-ink-600 hover:bg-ink-50'
					}`}
				>
					{translate($lang, 'staffManagement')}
				</button>
			</div>
			<button
				onclick={refresh}
				class="flex items-center gap-1.5 rounded-xl border border-ink-200 bg-surface px-4 py-2 text-sm font-medium text-ink-700 shadow-soft transition hover:bg-ink-50"
			>
				<RefreshCw size={15} />
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
				<div class="rounded-3xl border border-ink-100 bg-surface p-5 shadow-soft transition hover:shadow-lift">
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
			<div class="rounded-3xl border border-ink-100 bg-surface p-6 shadow-soft">
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
										<td class="px-3 py-2.5 text-right text-amber-600">{a.pending}</td>
										<td class="px-3 py-2.5 text-right text-green-600">{a.approved}</td>
										<td class="px-3 py-2.5 text-right text-red-600">{a.rejected}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>

			<div class="rounded-3xl border border-ink-100 bg-surface p-6 shadow-soft">
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
										<td class="px-3 py-2.5 text-right text-amber-600">{f.pending}</td>
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

		<div class="overflow-x-auto rounded-3xl border border-ink-100 bg-surface shadow-soft">
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
	{:else if activeTab === 'audit'}
		<div class="rounded-3xl border border-ink-100 bg-surface p-6 shadow-soft">
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
	{:else if activeTab === 'activities'}
		<div class="rounded-3xl border border-ink-100 bg-surface p-6 shadow-soft">
			<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
				<h2 class="flex items-center gap-2 text-lg font-bold text-ink-900">
					<CalendarDays size={18} class="text-brand-600" />
					{translate($lang, 'activities')}
				</h2>
				<button
					onclick={openAddActivity}
					class="flex items-center gap-1.5 rounded-xl bg-ink-900 px-4 py-2 text-sm font-semibold text-ink-50 shadow-soft transition hover:bg-ink-700"
				>
					<Plus size={16} />
					{translate($lang, 'addActivity')}
				</button>
			</div>
			{#if activities.length === 0}
				<p class="text-sm text-ink-500">{translate($lang, 'noActivities')}</p>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full text-left text-sm">
						<thead class="border-b border-ink-100 text-xs font-semibold uppercase tracking-wide text-ink-500">
							<tr>
								<th class="px-3 py-2">{translate($lang, 'activity')}</th>
								<th class="px-3 py-2">{translate($lang, 'type')}</th>
								<th class="hidden px-3 py-2 md:table-cell">{translate($lang, 'organizer')}</th>
								<th class="hidden px-3 py-2 lg:table-cell">{translate($lang, 'date')}</th>
								<th class="hidden px-3 py-2 md:table-cell">{translate($lang, 'location')}</th>
								<th class="px-3 py-2">{translate($lang, 'status')}</th>
								<th class="px-3 py-2 text-right">{translate($lang, 'actions')}</th>
							</tr>
						</thead>
						<tbody>
							{#each activities as a (a.id)}
								<tr class="border-b border-ink-50 last:border-0">
									<td class="px-3 py-2.5 font-medium text-ink-900">{activityTitle(a)}</td>
									<td class="px-3 py-2.5 text-ink-600">{a.type}</td>
									<td class="hidden px-3 py-2.5 text-ink-600 md:table-cell">{a.organizer}</td>
									<td class="hidden whitespace-nowrap px-3 py-2.5 text-ink-600 lg:table-cell">
										{activityDateStr(a.date)}
									</td>
									<td class="hidden px-3 py-2.5 text-ink-600 md:table-cell">{a.location}</td>
									<td class="px-3 py-2.5">
										<span
											class={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
												a.isActive ? 'bg-green-50 text-green-700 ring-1 ring-green-200' : 'bg-ink-100 text-ink-600 ring-1 ring-ink-200'
											}`}
										>
											{translate($lang, a.isActive ? 'active' : 'inactive')}
										</span>
									</td>
									<td class="px-3 py-2.5">
										<div class="flex justify-end gap-1.5">
											<button
												onclick={() => openEditActivity(a)}
												title={translate($lang, 'editActivity')}
												class="rounded-lg bg-ink-100 p-2 text-ink-600 transition hover:bg-brand-100 hover:text-brand-700"
											>
												<Pencil size={15} />
											</button>
											<button
												onclick={() => (deleteTarget = a)}
												title={translate($lang, 'deleteActivity')}
												class="rounded-lg bg-red-50 p-2 text-red-600 transition hover:bg-red-100"
											>
												<Trash2 size={15} />
											</button>
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>
	{:else if activeTab === 'staff'}
		<div class="rounded-3xl border border-ink-100 bg-surface p-6 shadow-soft">
			<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
				<h2 class="flex items-center gap-2 text-lg font-bold text-ink-900">
					<Users size={18} class="text-brand-600" />
					{translate($lang, 'staffManagement')}
				</h2>
				<button
					onclick={openAddStaff}
					class="flex items-center gap-1.5 rounded-xl bg-ink-900 px-4 py-2 text-sm font-semibold text-ink-50 shadow-soft transition hover:bg-ink-700"
				>
					<UserPlus size={16} />
					{translate($lang, 'addStaff')}
				</button>
			</div>
			{#if staffMsg}
				<div class="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
					{staffMsg}
				</div>
			{/if}
			{#if staffList.length === 0}
				<p class="text-sm text-ink-500">{translate($lang, 'noResults')}</p>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full text-left text-sm">
						<thead class="border-b border-ink-100 text-xs font-semibold uppercase tracking-wide text-ink-500">
							<tr>
								<th class="px-3 py-2">{translate($lang, 'nameLabel')}</th>
								<th class="px-3 py-2">{translate($lang, 'staffCode')}</th>
								<th class="hidden px-3 py-2 md:table-cell">{translate($lang, 'role')}</th>
								<th class="hidden px-3 py-2 md:table-cell">{translate($lang, 'kind')}</th>
								<th class="px-3 py-2">{translate($lang, 'status')}</th>
								<th class="px-3 py-2 text-right">{translate($lang, 'actions')}</th>
							</tr>
						</thead>
						<tbody>
							{#each staffList as s (s.id)}
								<tr class="border-b border-ink-50 last:border-0">
									<td class="px-3 py-2.5 font-medium text-ink-900">{s.fullName}</td>
									<td class="px-3 py-2.5 font-mono text-ink-700">{s.staffCode}</td>
									<td class="hidden px-3 py-2.5 text-ink-600 md:table-cell">
										{translate($lang, s.role === 'admin' ? 'admin' : 'staff')}
									</td>
									<td class="hidden px-3 py-2.5 md:table-cell">
										{#if s.kind === 'emergency'}
											<span class="inline-flex rounded-full bg-purple-50 px-2.5 py-1 text-xs font-semibold text-purple-700 ring-1 ring-purple-200">
												{translate($lang, 'emergency')}
											</span>
										{:else}
											<span class="inline-flex rounded-full bg-ink-50 px-2.5 py-1 text-xs font-medium text-ink-600 ring-1 ring-ink-200">
												{translate($lang, 'mainAccount')}
											</span>
										{/if}
									</td>
									<td class="px-3 py-2.5">
										<span
											class={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
												s.isActive ? 'bg-green-50 text-green-700 ring-1 ring-green-200' : 'bg-red-50 text-red-700 ring-1 ring-red-200'
											}`}
										>
											{translate($lang, s.isActive ? 'accountActive' : 'accountDisabled')}
										</span>
									</td>
									<td class="px-3 py-2.5">
										<div class="flex justify-end gap-1.5">
											<button
												onclick={() => openEditStaff(s)}
												title={translate($lang, 'editStaff')}
												class="rounded-lg bg-ink-100 p-2 text-ink-600 transition hover:bg-brand-100 hover:text-brand-700"
											>
												<Pencil size={15} />
											</button>
											<button
												onclick={() => toggleStaffActive(s)}
												title={translate($lang, s.isActive ? 'disableAccount' : 'enableAccount')}
												class={`rounded-lg p-2 transition ${
													s.isActive ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-green-50 text-green-600 hover:bg-green-100'
												}`}
											>
												<Power size={15} />
											</button>
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>
	{/if}

	{#if activityModal}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 p-4 backdrop-blur-sm"
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			onkeydown={(e) => { if (e.key === 'Escape') closeActivityModal(); }}
		>
			<div class="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-3xl border border-ink-100 bg-surface p-6 shadow-lift">
				<h2 class="mb-4 flex items-center gap-2 text-lg font-bold text-ink-900">
					<CalendarPlus size={19} class="text-brand-600" />
					{translate($lang, activityModal === 'add' ? 'addActivity' : 'editActivity')}
				</h2>
				<div class="space-y-4">
					<div class="grid gap-4 sm:grid-cols-2">
						<div>
							<label for="act-title" class="mb-1 block text-sm font-medium text-ink-700">
								{translate($lang, 'activity')}
							</label>
							<input
								id="act-title"
								bind:value={activityForm.title}
								type="text"
								required
								class="w-full rounded-xl border border-ink-200 bg-ink-50 px-3.5 py-2.5 text-sm transition focus:border-brand-500 focus:bg-surface focus:outline-none focus:ring-4 focus:ring-brand-100"
							/>
						</div>
						<div>
							<label for="act-title-en" class="mb-1 block text-sm font-medium text-ink-700">
								{translate($lang, 'titleEn')}
							</label>
							<input
								id="act-title-en"
								bind:value={activityForm.titleEn}
								type="text"
								required
								class="w-full rounded-xl border border-ink-200 bg-ink-50 px-3.5 py-2.5 text-sm transition focus:border-brand-500 focus:bg-surface focus:outline-none focus:ring-4 focus:ring-brand-100"
							/>
						</div>
					</div>
					<div class="grid gap-4 sm:grid-cols-2">
						<div>
							<label for="act-type" class="mb-1 block text-sm font-medium text-ink-700">
								{translate($lang, 'type')}
							</label>
							<input
								id="act-type"
								bind:value={activityForm.type}
								type="text"
								required
								class="w-full rounded-xl border border-ink-200 bg-ink-50 px-3.5 py-2.5 text-sm transition focus:border-brand-500 focus:bg-surface focus:outline-none focus:ring-4 focus:ring-brand-100"
							/>
						</div>
						<div>
							<label for="act-organizer" class="mb-1 block text-sm font-medium text-ink-700">
								{translate($lang, 'organizer')}
							</label>
							<input
								id="act-organizer"
								bind:value={activityForm.organizer}
								type="text"
								required
								class="w-full rounded-xl border border-ink-200 bg-ink-50 px-3.5 py-2.5 text-sm transition focus:border-brand-500 focus:bg-surface focus:outline-none focus:ring-4 focus:ring-brand-100"
							/>
						</div>
					</div>
					<div class="grid gap-4 sm:grid-cols-2">
						<div>
							<label for="act-date" class="mb-1 block text-sm font-medium text-ink-700">
								{translate($lang, 'date')}
							</label>
							<input
								id="act-date"
								bind:value={activityForm.dateStr}
								type="date"
								required
								class="w-full rounded-xl border border-ink-200 bg-ink-50 px-3.5 py-2.5 text-sm transition focus:border-brand-500 focus:bg-surface focus:outline-none focus:ring-4 focus:ring-brand-100"
							/>
						</div>
						<div>
							<label for="act-deadline" class="mb-1 block text-sm font-medium text-ink-700">
								{translate($lang, 'submissionDeadline')}
							</label>
							<input
								id="act-deadline"
								bind:value={activityForm.deadlineStr}
								type="datetime-local"
								class="w-full rounded-xl border border-ink-200 bg-ink-50 px-3.5 py-2.5 text-sm transition focus:border-brand-500 focus:bg-surface focus:outline-none focus:ring-4 focus:ring-brand-100"
							/>
						</div>
					</div>
					<div>
						<label for="act-location" class="mb-1 block text-sm font-medium text-ink-700">
							{translate($lang, 'location')}
						</label>
						<input
							id="act-location"
							bind:value={activityForm.location}
							type="text"
							required
							class="w-full rounded-xl border border-ink-200 bg-ink-50 px-3.5 py-2.5 text-sm transition focus:border-brand-500 focus:bg-surface focus:outline-none focus:ring-4 focus:ring-brand-100"
						/>
					</div>
					<div class="grid gap-4 sm:grid-cols-2">
						<div>
							<label for="act-desc" class="mb-1 block text-sm font-medium text-ink-700">
								{translate($lang, 'description')}
							</label>
							<textarea
								id="act-desc"
								bind:value={activityForm.description}
								rows="3"
								class="w-full rounded-xl border border-ink-200 bg-ink-50 px-3.5 py-2.5 text-sm transition focus:border-brand-500 focus:bg-surface focus:outline-none focus:ring-4 focus:ring-brand-100"
							></textarea>
						</div>
						<div>
							<label for="act-desc-en" class="mb-1 block text-sm font-medium text-ink-700">
								{translate($lang, 'descriptionEn')}
							</label>
							<textarea
								id="act-desc-en"
								bind:value={activityForm.descriptionEn}
								rows="3"
								class="w-full rounded-xl border border-ink-200 bg-ink-50 px-3.5 py-2.5 text-sm transition focus:border-brand-500 focus:bg-surface focus:outline-none focus:ring-4 focus:ring-brand-100"
							></textarea>
						</div>
					</div>
					<label class="flex items-center gap-2 text-sm font-medium text-ink-700">
						<input type="checkbox" bind:checked={activityForm.isActive} class="h-4 w-4 accent-brand-600" />
						{translate($lang, 'active')}
					</label>
					{#if activityMsg}
						<p class="text-sm text-red-600">{activityMsg}</p>
					{/if}
					<div class="flex justify-end gap-2 border-t border-ink-100 pt-4">
						<button
							onclick={closeActivityModal}
							class="rounded-xl border border-ink-200 bg-surface px-4 py-2 text-sm font-medium text-ink-700 transition hover:bg-ink-50"
						>
							{translate($lang, 'cancel')}
						</button>
						<button
							onclick={saveActivity}
							disabled={savingActivity}
							class="flex items-center gap-1.5 rounded-xl bg-brand-600 px-5 py-2 text-sm font-semibold text-white shadow-soft transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
						>
							{savingActivity ? translate($lang, 'submitting') : translate($lang, 'save')}
						</button>
					</div>
				</div>
			</div>
		</div>
	{/if}

	{#if staffModal}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 p-4 backdrop-blur-sm"
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			onkeydown={(e) => { if (e.key === 'Escape') closeStaffModal(); }}
		>
			<div class="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-ink-100 bg-surface p-6 shadow-lift">
				<h2 class="mb-4 flex items-center gap-2 text-lg font-bold text-ink-900">
					<UserPlus size={19} class="text-brand-600" />
					{translate($lang, staffModal === 'add' ? 'createStaff' : 'editStaff')}
				</h2>
				<div class="space-y-4">
					<div>
						<label for="st-fullname" class="mb-1 block text-sm font-medium text-ink-700">
							{translate($lang, 'fullNameLabel')}
						</label>
						<input
							id="st-fullname"
							bind:value={staffForm.fullName}
							type="text"
							required
							class="w-full rounded-xl border border-ink-200 bg-ink-50 px-3.5 py-2.5 text-sm transition focus:border-brand-500 focus:bg-surface focus:outline-none focus:ring-4 focus:ring-brand-100"
						/>
					</div>
					<div class="grid gap-4 sm:grid-cols-2">
						<div>
							<label for="st-code" class="mb-1 block text-sm font-medium text-ink-700">
								{translate($lang, 'staffCode')}
							</label>
							<input
								id="st-code"
								bind:value={staffForm.staffCode}
								type="text"
								required
								autocomplete="off"
								class="w-full rounded-xl border border-ink-200 bg-ink-50 px-3.5 py-2.5 text-sm transition focus:border-brand-500 focus:bg-surface focus:outline-none focus:ring-4 focus:ring-brand-100"
							/>
						</div>
						<div>
							<label for="st-password" class="mb-1 block text-sm font-medium text-ink-700">
								{translate($lang, 'password')}
							</label>
							<input
								id="st-password"
								bind:value={staffForm.password}
								type="password"
								required={staffModal === 'add'}
								placeholder={staffModal === 'edit' ? '••••••••' : ''}
								autocomplete="new-password"
								class="w-full rounded-xl border border-ink-200 bg-ink-50 px-3.5 py-2.5 text-sm transition focus:border-brand-500 focus:bg-surface focus:outline-none focus:ring-4 focus:ring-brand-100"
							/>
						</div>
					</div>
					<div class="grid gap-4 sm:grid-cols-2">
						<div>
							<label for="st-role" class="mb-1 block text-sm font-medium text-ink-700">
								{translate($lang, 'role')}
							</label>
							<select
								id="st-role"
								bind:value={staffForm.role}
								class="w-full rounded-xl border border-ink-200 bg-ink-50 px-3.5 py-2.5 text-sm transition focus:border-brand-500 focus:bg-surface focus:outline-none focus:ring-4 focus:ring-brand-100"
							>
								<option value="staff">{translate($lang, 'staff')}</option>
								<option value="admin">{translate($lang, 'admin')}</option>
							</select>
						</div>
						<div>
							<label for="st-kind" class="mb-1 block text-sm font-medium text-ink-700">
								{translate($lang, 'kind')}
							</label>
							<select
								id="st-kind"
								bind:value={staffForm.kind}
								class="w-full rounded-xl border border-ink-200 bg-ink-50 px-3.5 py-2.5 text-sm transition focus:border-brand-500 focus:bg-surface focus:outline-none focus:ring-4 focus:ring-brand-100"
							>
								<option value="main">{translate($lang, 'mainAccount')}</option>
								<option value="emergency">{translate($lang, 'emergency')}</option>
							</select>
						</div>
					</div>
					{#if staffModal === 'edit'}
						<label class="flex items-center gap-2 text-sm font-medium text-ink-700">
							<input type="checkbox" bind:checked={staffForm.isActive} class="h-4 w-4 accent-brand-600" />
							{translate($lang, 'accountActive')}
						</label>
					{/if}
					{#if staffMsg}
						<p class="text-sm text-red-600">{staffMsg}</p>
					{/if}
					<div class="flex justify-end gap-2 border-t border-ink-100 pt-4">
						<button
							onclick={closeStaffModal}
							class="rounded-xl border border-ink-200 bg-surface px-4 py-2 text-sm font-medium text-ink-700 transition hover:bg-ink-50"
						>
							{translate($lang, 'cancel')}
						</button>
						<button
							onclick={saveStaff}
							disabled={savingStaff}
							class="flex items-center gap-1.5 rounded-xl bg-brand-600 px-5 py-2 text-sm font-semibold text-white shadow-soft transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
						>
							{savingStaff ? translate($lang, 'submitting') : translate($lang, 'save')}
						</button>
					</div>
				</div>
			</div>
		</div>
	{/if}

	{#if deleteTarget}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 p-4 backdrop-blur-sm"
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			onclick={(e) => { if (e.target === e.currentTarget) deleteTarget = null; }}
			onkeydown={(e) => { if (e.key === 'Escape') deleteTarget = null; }}
		>
			<div class="w-full max-w-sm rounded-3xl border border-ink-100 bg-surface p-6 shadow-lift">
				<h2 class="mb-3 flex items-center gap-2 text-lg font-bold text-ink-900">
					<Trash2 size={19} class="text-red-600" />
					{translate($lang, 'deleteActivity')}
				</h2>
				<p class="text-sm text-ink-600">{translate($lang, 'confirmDeleteActivity')}</p>
				<div class="mt-5 flex justify-end gap-2">
					<button
						onclick={() => (deleteTarget = null)}
						class="rounded-xl border border-ink-200 bg-surface px-4 py-2 text-sm font-medium text-ink-700 transition hover:bg-ink-50"
					>
						{translate($lang, 'cancel')}
					</button>
					<button
						onclick={removeActivity}
						class="flex items-center gap-1.5 rounded-xl bg-red-600 px-5 py-2 text-sm font-semibold text-white shadow-soft transition hover:bg-red-700"
					>
						<Trash2 size={15} />
						{translate($lang, 'delete')}
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>
