<script lang="ts">
	import { onMount } from 'svelte';
	import { lang } from '$lib/store';
	import { user, loadSession } from '$lib/auth';
	import { translate } from '$lib/i18n';
	import { formatBangkokDateTime } from '$lib/datetime';
	import { goto } from '$app/navigation';
	import {
		getRequests,
		getStats,
		getAuditLogs,
		getStaffList,
		createStaff,
		updateStaff,
		type RequestItem,
		type StatsResponse,
		type AuditLogItem,
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
		Pencil,
		UserPlus,
		KeyRound,
		Power,
	} from 'lucide-svelte';

	let requests: RequestItem[] = $state([]);
	let stats = $state<StatsResponse | null>(null);
	let auditLogs: AuditLogItem[] = $state([]);
	let loading: boolean = $state(true);
	let activeTab: 'stats' | 'audit' | 'staff' = $state('stats');
	let staffList: StaffMember[] = $state([]);
	let staffModal: 'add' | 'edit' | null = $state(null);
	let editingStaffId: string | null = $state(null);
	let staffMsg: string = $state('');
	let savingStaff: boolean = $state(false);
	let staffForm = $state<StaffInput & { isActive: boolean }>(emptyStaffForm());

	function emptyStaffForm() {
		return {
			staffCode: '',
			fullName: '',
			password: '',
			role: 'staff' as const,
			kind: 'main' as const,
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
			const [req, st, audit, staffRows] = await Promise.all([
				getRequests(),
				getStats(),
				getAuditLogs(),
				getStaffList(),
			]);
			requests = req;
			stats = st;
			auditLogs = audit;
			staffList = staffRows;
		} finally {
			loading = false;
		}
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

	function actionLabel(action: string) {
		const map: Record<string, string> = {
			approve: $lang === 'th' ? 'อนุมัติ' : 'Approve',
			reject: $lang === 'th' ? 'ไม่อนุมัติ' : 'Reject',
			staff_check: translate($lang, 'staffCheckAuditAction'),
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

		<div>
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
							<td class="px-5 py-4 font-medium text-ink-800">{r.student?.name}</td>
							<td class="hidden px-5 py-4 text-ink-600 lg:table-cell">
								{r.student?.studentId ?? '-'}
							</td>
							<td class="hidden px-5 py-4 text-ink-600 md:table-cell">
								{r.student?.faculty ?? '-'}
							</td>
							<td class="hidden px-5 py-4 text-ink-600 lg:table-cell">
								{formatBangkokDateTime(r.submittedAt, $lang)}
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
									<td class="min-w-36 px-3 py-2.5 text-ink-600">
										{formatBangkokDateTime(log.createdAt, $lang)}
									</td>
									<td class="px-3 py-2.5 whitespace-nowrap text-ink-700">{log.actorName ?? (log.actorStaffId ? log.actorStaffId.slice(0, 8) : '-')}</td>
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
</div>

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
