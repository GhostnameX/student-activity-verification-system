<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { lang } from '$lib/store';
	import { user, loadSession } from '$lib/auth';
	import { translate, type TKey } from '$lib/i18n';
	import {
		createRosterStudent,
		getRosterStudents,
		restoreRosterStudent,
		softDeleteRosterStudent,
		updateRosterStudent,
		type RosterRecord,
		type RosterSortField,
		type RosterStudentInput,
		type StudentStatus,
	} from '$lib/api';
	import {
		ChevronLeft,
		ChevronRight,
		Pencil,
		RefreshCw,
		RotateCcw,
		Search,
		Trash2,
		UserPlus,
		UsersRound,
		X,
	} from 'lucide-svelte';

	const pageSize = 20;
	const statusOptions: StudentStatus[] = ['active', 'graduated', 'withdrawn'];
	const sortOptions: Array<{ value: RosterSortField; label: TKey }> = [
		{ value: 'studentId', label: 'studentId' },
		{ value: 'firstName', label: 'firstName' },
		{ value: 'lastName', label: 'lastName' },
		{ value: 'major', label: 'major' },
		{ value: 'status', label: 'status' },
		{ value: 'admissionYear', label: 'admissionYear' },
		{ value: 'createdAt', label: 'createdAt' },
		{ value: 'updatedAt', label: 'updatedAt' },
	];

	interface StudentForm {
		studentId: string;
		firstName: string;
		lastName: string;
		major: string;
		groupName: string;
		level: string;
		admissionYear: number;
		status: StudentStatus;
		email: string;
		phone: string;
	}

	function emptyForm(): StudentForm {
		return {
			studentId: '',
			firstName: '',
			lastName: '',
			major: '',
			groupName: '',
			level: '',
			admissionYear: new Date().getFullYear() + 543,
			status: 'active',
			email: '',
			phone: '',
		};
	}

	let rows: RosterRecord[] = $state([]);
	let total = $state(0);
	let page = $state(1);
	let search = $state('');
	let statusFilter: '' | StudentStatus = $state('');
	let includeDeleted = $state(false);
	let sort: RosterSortField = $state('studentId');
	let order: 'asc' | 'desc' = $state('asc');
	let loading = $state(true);
	let loadError = $state('');
	let message = $state('');
	let messageError = $state(false);
	let modal: 'create' | 'edit' | null = $state(null);
	let editing: RosterRecord | null = $state(null);
	let form: StudentForm = $state(emptyForm());
	let saving = $state(false);
	let formError = $state('');
	let deleteTarget: RosterRecord | null = $state(null);
	let deleting = $state(false);
	let restoringId: string | null = $state(null);
	let requestId = 0;
	let searchTimer: ReturnType<typeof setTimeout> | undefined;

	let totalPages = $derived(Math.max(1, Math.ceil(total / pageSize)));
	let firstShown = $derived(total === 0 ? 0 : (page - 1) * pageSize + 1);
	let lastShown = $derived(Math.min(total, page * pageSize));

	onMount(async () => {
		await loadSession();
		if (!$user) {
			goto('/auth/signin');
			return;
		}
		if ($user.role !== 'staff' && $user.role !== 'admin') {
			goto('/student');
			return;
		}
		await loadRoster();
	});

	onDestroy(() => clearTimeout(searchTimer));

	async function loadRoster() {
		const currentRequest = ++requestId;
		loading = true;
		loadError = '';
		try {
			const result = await getRosterStudents({
				page,
				pageSize,
				search: search.trim() || undefined,
				status: statusFilter || undefined,
				includeDeleted,
				sort,
				order,
			});
			if (currentRequest !== requestId) return;
			rows = result.items;
			total = result.total;
			if (page > Math.max(1, Math.ceil(result.total / pageSize))) {
				page = Math.max(1, Math.ceil(result.total / pageSize));
				await loadRoster();
			}
		} catch {
			if (currentRequest !== requestId) return;
			rows = [];
			total = 0;
			loadError = translate($lang, 'rosterLoadError');
		} finally {
			if (currentRequest === requestId) loading = false;
		}
	}

	function onSearchInput() {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => applyFilters(), 350);
	}

	function applyFilters() {
		clearTimeout(searchTimer);
		page = 1;
		loadRoster();
	}

	function clearFilters() {
		clearTimeout(searchTimer);
		search = '';
		statusFilter = '';
		includeDeleted = false;
		sort = 'studentId';
		order = 'asc';
		page = 1;
		loadRoster();
	}

	async function goPage(nextPage: number) {
		if (nextPage < 1 || nextPage > totalPages || nextPage === page) return;
		page = nextPage;
		await loadRoster();
	}

	function openCreate() {
		form = emptyForm();
		editing = null;
		formError = '';
		modal = 'create';
	}

	function openEdit(student: RosterRecord) {
		editing = student;
		form = {
			studentId: student.studentId,
			firstName: student.firstName,
			lastName: student.lastName,
			major: student.major,
			groupName: student.groupName ?? '',
			level: student.level ?? '',
			admissionYear: student.admissionYear,
			status: student.status,
			email: student.email ?? '',
			phone: student.phone ?? '',
		};
		formError = '';
		modal = 'edit';
	}

	function closeModal() {
		if (saving) return;
		modal = null;
		editing = null;
		formError = '';
	}

	function nullable(value: string): string | null {
		const trimmed = value.trim();
		return trimmed === '' ? null : trimmed;
	}

	function errorMessage(error: unknown): string {
		const code = error instanceof Error ? error.message : String(error);
		const messages: Record<string, TKey> = {
			duplicate_student_id: 'duplicateStudentId',
			duplicate_email: 'duplicateEmail',
			email_readonly_bound: 'boundEmailHint',
			student_already_deleted: 'studentAlreadyDeleted',
			not_deleted: 'studentNotDeleted',
		};
		return translate($lang, messages[code] ?? 'rosterSaveError');
	}

	async function saveStudent() {
		if (
			!form.studentId.trim() ||
			!form.firstName.trim() ||
			!form.lastName.trim() ||
			!form.major.trim() ||
			!Number.isInteger(form.admissionYear)
		) {
			formError = translate($lang, 'requiredFields');
			return;
		}

		saving = true;
		formError = '';
		const details = {
			firstName: form.firstName.trim(),
			lastName: form.lastName.trim(),
			major: form.major.trim(),
			groupName: nullable(form.groupName),
			level: nullable(form.level),
			admissionYear: Number(form.admissionYear),
			status: form.status,
			email: nullable(form.email),
			phone: nullable(form.phone),
		};

		try {
			if (modal === 'create') {
				const payload: RosterStudentInput = { studentId: form.studentId.trim(), ...details };
				await createRosterStudent(payload);
				showMessage('createdStudent');
			} else if (editing) {
				if (editing.emailBoundAt) {
					const { email: _boundEmail, ...safeDetails } = details;
					await updateRosterStudent(editing.studentId, safeDetails);
				} else {
					await updateRosterStudent(editing.studentId, details);
				}
				showMessage('updatedStudent');
			}
			modal = null;
			editing = null;
			await loadRoster();
		} catch (error) {
			formError = errorMessage(error);
		} finally {
			saving = false;
		}
	}

	function showMessage(key: TKey, isError = false) {
		message = translate($lang, key);
		messageError = isError;
	}

	async function confirmDelete() {
		if (!deleteTarget) return;
		deleting = true;
		try {
			await softDeleteRosterStudent(deleteTarget.studentId);
			deleteTarget = null;
			showMessage('deletedStudent');
			await loadRoster();
		} catch (error) {
			message = errorMessage(error);
			messageError = true;
			deleteTarget = null;
			await loadRoster();
		} finally {
			deleting = false;
		}
	}

	async function restore(student: RosterRecord) {
		restoringId = student.studentId;
		try {
			await restoreRosterStudent(student.studentId);
			showMessage('restoredStudent');
			await loadRoster();
		} catch (error) {
			message = errorMessage(error);
			messageError = true;
			await loadRoster();
		} finally {
			restoringId = null;
		}
	}

	function statusLabel(status: StudentStatus): string {
		return translate($lang, status);
	}

	function statusClass(status: StudentStatus): string {
		if (status === 'active') return 'bg-green-50 text-green-700 ring-green-200';
		if (status === 'graduated') return 'bg-brand-50 text-brand-700 ring-brand-200';
		return 'bg-amber-50 text-amber-700 ring-amber-200';
	}
</script>

<div class="space-y-5">
	<header class="flex flex-wrap items-start justify-between gap-4">
		<div>
			<h1 class="flex items-center gap-2 text-2xl font-bold text-ink-900 sm:text-3xl">
				<UsersRound size={26} class="text-brand-600" />
				{translate($lang, 'rosterManagement')}
			</h1>
			<p class="mt-1 text-sm text-ink-500">{translate($lang, 'rosterSubtitle')}</p>
		</div>
		<button
			type="button"
			onclick={openCreate}
			class="flex min-h-10 items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-soft transition hover:bg-brand-700"
		>
			<UserPlus size={17} />
			{translate($lang, 'addStudent')}
		</button>
	</header>

	<section class="border-y border-ink-100 bg-surface px-0 py-4 sm:px-4" aria-label={translate($lang, 'filters')}>
		<div class="grid gap-3 md:grid-cols-[minmax(15rem,1fr)_auto_auto] xl:grid-cols-[minmax(18rem,1fr)_12rem_15rem_auto]">
			<div class="relative">
				<Search size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
				<input
					bind:value={search}
					oninput={onSearchInput}
					onkeydown={(event) => { if (event.key === 'Enter') applyFilters(); }}
					placeholder={translate($lang, 'searchPlaceholder')}
					class="h-10 w-full rounded-lg border border-ink-200 bg-ink-50 pl-9 pr-3 text-sm text-ink-900 focus:border-brand-500 focus:bg-surface focus:outline-none focus:ring-4 focus:ring-brand-100"
				/>
			</div>
			<select
				bind:value={statusFilter}
				onchange={applyFilters}
				aria-label={translate($lang, 'status')}
				class="h-10 rounded-lg border border-ink-200 bg-ink-50 px-3 text-sm text-ink-900 focus:border-brand-500 focus:outline-none"
			>
				<option value="">{translate($lang, 'allStatuses')}</option>
				{#each statusOptions as value}
					<option value={value}>{statusLabel(value)}</option>
				{/each}
			</select>
			<div class="grid grid-cols-[1fr_auto] gap-2">
				<select
					bind:value={sort}
					onchange={applyFilters}
					aria-label={translate($lang, 'sortBy')}
					class="h-10 min-w-0 rounded-lg border border-ink-200 bg-ink-50 px-3 text-sm text-ink-900 focus:border-brand-500 focus:outline-none"
				>
					{#each sortOptions as option}
						<option value={option.value}>{translate($lang, option.label)}</option>
					{/each}
				</select>
				<select
					bind:value={order}
					onchange={applyFilters}
					aria-label={translate($lang, 'sortBy')}
					class="h-10 rounded-lg border border-ink-200 bg-ink-50 px-3 text-sm text-ink-900 focus:border-brand-500 focus:outline-none"
				>
					<option value="asc">{translate($lang, 'ascending')}</option>
					<option value="desc">{translate($lang, 'descending')}</option>
				</select>
			</div>
			<div class="flex min-h-10 flex-wrap items-center gap-2">
				<label class="flex min-h-10 items-center gap-2 rounded-lg border border-ink-200 px-3 text-sm text-ink-700">
					<input type="checkbox" bind:checked={includeDeleted} onchange={applyFilters} class="h-4 w-4 accent-brand-600" />
					{translate($lang, 'includeDeleted')}
				</label>
				<button
					type="button"
					onclick={clearFilters}
					class="flex h-10 w-10 items-center justify-center rounded-lg border border-ink-200 text-ink-600 transition hover:bg-ink-50"
					title={translate($lang, 'clearFilters')}
					aria-label={translate($lang, 'clearFilters')}
				>
					<X size={16} />
				</button>
			</div>
		</div>
	</section>

	{#if message}
		<div class={`border px-4 py-3 text-sm ${messageError ? 'border-red-200 bg-red-50 text-red-700' : 'border-green-200 bg-green-50 text-green-700'}`}>
			{message}
		</div>
	{/if}
	{#if loadError}
		<div class="flex items-center justify-between gap-3 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
			<span>{loadError}</span>
			<button type="button" onclick={loadRoster} class="rounded-lg p-2 hover:bg-red-100" aria-label={translate($lang, 'refresh')}>
				<RefreshCw size={16} />
			</button>
		</div>
	{/if}

	<div class="hidden overflow-x-auto border-y border-ink-100 bg-surface md:block">
		<table class="w-full min-w-[980px] text-left text-sm">
			<thead class="border-b border-ink-100 bg-ink-50 text-xs font-semibold uppercase text-ink-500">
				<tr>
					<th class="px-4 py-3">{translate($lang, 'studentId')}</th>
					<th class="px-4 py-3">{translate($lang, 'nameLabel')}</th>
					<th class="px-4 py-3">{translate($lang, 'major')}</th>
					<th class="px-4 py-3">{translate($lang, 'status')}</th>
					<th class="px-4 py-3">{translate($lang, 'email')}</th>
					<th class="px-4 py-3 text-right">{translate($lang, 'actions')}</th>
				</tr>
			</thead>
			<tbody>
				{#if loading}
					<tr><td colspan="6" class="px-4 py-12 text-center text-ink-500">{translate($lang, 'submitting')}</td></tr>
				{:else if rows.length === 0}
					<tr><td colspan="6" class="px-4 py-12 text-center text-ink-500">{translate($lang, 'noResults')}</td></tr>
				{:else}
					{#each rows as student (student.studentId)}
						<tr class={`border-b border-ink-50 last:border-0 ${student.deletedAt ? 'bg-red-50/40' : 'hover:bg-ink-50/60'}`}>
							<td class="whitespace-nowrap px-4 py-3 font-mono text-xs text-ink-700">{student.studentId}</td>
							<td class="px-4 py-3 font-medium text-ink-900">{student.firstName} {student.lastName}</td>
							<td class="px-4 py-3 text-ink-600">
								{student.major}
								<div class="mt-0.5 text-xs text-ink-400">{student.groupName ?? '-'} · {student.level ?? '-'}</div>
							</td>
							<td class="px-4 py-3">
								<div class="flex flex-wrap gap-1.5">
									<span class={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${statusClass(student.status)}`}>{statusLabel(student.status)}</span>
									{#if student.deletedAt}<span class="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 ring-1 ring-red-200">{translate($lang, 'deletedStatus')}</span>{/if}
								</div>
							</td>
							<td class="max-w-64 px-4 py-3 text-ink-600">
								<div class="truncate">{student.email ?? '-'}</div>
								{#if student.emailBoundAt}<div class="mt-0.5 text-xs text-brand-600">{translate($lang, 'boundEmail')}</div>{/if}
							</td>
							<td class="px-4 py-3">
								<div class="flex justify-end gap-1.5">
									<button type="button" onclick={() => openEdit(student)} class="rounded-lg p-2 text-ink-600 transition hover:bg-brand-50 hover:text-brand-700" title={translate($lang, 'editStudent')}><Pencil size={16} /></button>
									{#if student.deletedAt}
										<button type="button" onclick={() => restore(student)} disabled={restoringId === student.studentId} class="rounded-lg p-2 text-green-700 transition hover:bg-green-50 disabled:opacity-50" title={translate($lang, 'restoreStudent')}><RotateCcw size={16} class={restoringId === student.studentId ? 'animate-spin' : ''} /></button>
									{:else}
										<button type="button" onclick={() => (deleteTarget = student)} class="rounded-lg p-2 text-red-600 transition hover:bg-red-50" title={translate($lang, 'deleteStudent')}><Trash2 size={16} /></button>
									{/if}
								</div>
							</td>
						</tr>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>

	<div class="grid gap-3 md:hidden">
		{#if loading}
			<div class="py-12 text-center text-sm text-ink-500">{translate($lang, 'submitting')}</div>
		{:else if rows.length === 0}
			<div class="py-12 text-center text-sm text-ink-500">{translate($lang, 'noResults')}</div>
		{:else}
			{#each rows as student (student.studentId)}
				<article class={`rounded-lg border p-4 ${student.deletedAt ? 'border-red-200 bg-red-50/40' : 'border-ink-100 bg-surface'}`}>
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0">
							<p class="truncate font-semibold text-ink-900">{student.firstName} {student.lastName}</p>
							<p class="mt-0.5 font-mono text-xs text-ink-500">{student.studentId}</p>
						</div>
						<div class="flex shrink-0 gap-1">
							<button type="button" onclick={() => openEdit(student)} class="rounded-lg p-2 text-ink-600 hover:bg-ink-50" aria-label={translate($lang, 'editStudent')}><Pencil size={16} /></button>
							{#if student.deletedAt}
								<button type="button" onclick={() => restore(student)} disabled={restoringId === student.studentId} class="rounded-lg p-2 text-green-700 hover:bg-green-50 disabled:opacity-50" aria-label={translate($lang, 'restoreStudent')}><RotateCcw size={16} /></button>
							{:else}
								<button type="button" onclick={() => (deleteTarget = student)} class="rounded-lg p-2 text-red-600 hover:bg-red-50" aria-label={translate($lang, 'deleteStudent')}><Trash2 size={16} /></button>
							{/if}
						</div>
					</div>
					<div class="mt-3 grid grid-cols-2 gap-2 text-xs text-ink-600">
						<span class="col-span-2">{student.major}</span>
						<span>{student.groupName ?? '-'}</span><span>{student.level ?? '-'}</span>
						<span class={`w-fit rounded-full px-2 py-1 font-semibold ring-1 ${statusClass(student.status)}`}>{statusLabel(student.status)}</span>
						{#if student.deletedAt}<span class="w-fit rounded-full bg-red-50 px-2 py-1 font-semibold text-red-700 ring-1 ring-red-200">{translate($lang, 'deletedStatus')}</span>{/if}
					</div>
				</article>
			{/each}
		{/if}
	</div>

	<footer class="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 pt-4">
		<p class="text-sm text-ink-500">{translate($lang, 'showingStudents').replace('{from}', String(firstShown)).replace('{to}', String(lastShown)).replace('{total}', String(total))}</p>
		<div class="flex items-center gap-2">
			<button type="button" onclick={() => goPage(page - 1)} disabled={page <= 1 || loading} class="flex h-10 w-10 items-center justify-center rounded-lg border border-ink-200 text-ink-700 enabled:hover:bg-ink-50 disabled:opacity-40" aria-label={translate($lang, 'prev')}><ChevronLeft size={17} /></button>
			<span class="min-w-24 text-center text-sm text-ink-600">{translate($lang, 'pageInfo').replace('{page}', String(page)).replace('{total}', String(totalPages))}</span>
			<button type="button" onclick={() => goPage(page + 1)} disabled={page >= totalPages || loading} class="flex h-10 w-10 items-center justify-center rounded-lg border border-ink-200 text-ink-700 enabled:hover:bg-ink-50 disabled:opacity-40" aria-label={translate($lang, 'next')}><ChevronRight size={17} /></button>
		</div>
	</footer>
</div>

{#if modal}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" tabindex="-1" onkeydown={(event) => { if (event.key === 'Escape') closeModal(); }} onclick={(event) => { if (event.target === event.currentTarget) closeModal(); }}>
		<form onsubmit={(event) => { event.preventDefault(); saveStudent(); }} class="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-surface p-5 shadow-lift sm:p-6">
			<div class="mb-5 flex items-center justify-between gap-3">
				<h2 class="text-xl font-bold text-ink-900">{translate($lang, modal === 'create' ? 'addStudent' : 'editStudent')}</h2>
				<button type="button" onclick={closeModal} class="rounded-lg p-2 text-ink-500 hover:bg-ink-50" aria-label={translate($lang, 'cancel')}><X size={18} /></button>
			</div>

			<div class="grid gap-4 sm:grid-cols-2">
				<label class="text-sm font-medium text-ink-700">{translate($lang, 'studentId')}
					<input bind:value={form.studentId} disabled={modal === 'edit'} required class="mt-1.5 h-10 w-full rounded-lg border border-ink-200 bg-ink-50 px-3 font-mono text-sm disabled:cursor-not-allowed disabled:text-ink-500" />
				</label>
				<label class="text-sm font-medium text-ink-700">{translate($lang, 'admissionYear')}
					<input bind:value={form.admissionYear} type="number" min="1900" max="2900" required class="mt-1.5 h-10 w-full rounded-lg border border-ink-200 bg-ink-50 px-3 text-sm" />
				</label>
				<label class="text-sm font-medium text-ink-700">{translate($lang, 'firstName')}
					<input bind:value={form.firstName} required class="mt-1.5 h-10 w-full rounded-lg border border-ink-200 bg-ink-50 px-3 text-sm" />
				</label>
				<label class="text-sm font-medium text-ink-700">{translate($lang, 'lastName')}
					<input bind:value={form.lastName} required class="mt-1.5 h-10 w-full rounded-lg border border-ink-200 bg-ink-50 px-3 text-sm" />
				</label>
				<label class="text-sm font-medium text-ink-700">{translate($lang, 'major')}
					<input bind:value={form.major} required class="mt-1.5 h-10 w-full rounded-lg border border-ink-200 bg-ink-50 px-3 text-sm" />
				</label>
				<label class="text-sm font-medium text-ink-700">{translate($lang, 'status')}
					<select bind:value={form.status} class="mt-1.5 h-10 w-full rounded-lg border border-ink-200 bg-ink-50 px-3 text-sm">
						{#each statusOptions as value}<option value={value}>{statusLabel(value)}</option>{/each}
					</select>
				</label>
				<label class="text-sm font-medium text-ink-700">{translate($lang, 'group')} <span class="font-normal text-ink-400">({translate($lang, 'optionalField')})</span>
					<input bind:value={form.groupName} class="mt-1.5 h-10 w-full rounded-lg border border-ink-200 bg-ink-50 px-3 text-sm" />
				</label>
				<label class="text-sm font-medium text-ink-700">{translate($lang, 'level')} <span class="font-normal text-ink-400">({translate($lang, 'optionalField')})</span>
					<input bind:value={form.level} class="mt-1.5 h-10 w-full rounded-lg border border-ink-200 bg-ink-50 px-3 text-sm" />
				</label>
				<label class="text-sm font-medium text-ink-700">{translate($lang, 'email')} <span class="font-normal text-ink-400">({translate($lang, 'optionalField')})</span>
					<input bind:value={form.email} type="email" disabled={Boolean(editing?.emailBoundAt)} class="mt-1.5 h-10 w-full rounded-lg border border-ink-200 bg-ink-50 px-3 text-sm disabled:cursor-not-allowed disabled:text-ink-500" />
					{#if editing?.emailBoundAt}<span class="mt-1 block text-xs text-brand-600">{translate($lang, 'boundEmailHint')}</span>{/if}
				</label>
				<label class="text-sm font-medium text-ink-700">{translate($lang, 'phone')} <span class="font-normal text-ink-400">({translate($lang, 'optionalField')})</span>
					<input bind:value={form.phone} type="tel" class="mt-1.5 h-10 w-full rounded-lg border border-ink-200 bg-ink-50 px-3 text-sm" />
				</label>
			</div>

			{#if formError}<p class="mt-4 border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>{/if}
			<div class="mt-6 flex justify-end gap-2 border-t border-ink-100 pt-4">
				<button type="button" onclick={closeModal} class="rounded-lg border border-ink-200 px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50">{translate($lang, 'cancel')}</button>
				<button type="submit" disabled={saving} class="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">{saving ? translate($lang, 'submitting') : translate($lang, 'save')}</button>
			</div>
		</form>
	</div>
{/if}

{#if deleteTarget}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="alertdialog" aria-modal="true">
		<div class="w-full max-w-md rounded-lg bg-surface p-6 shadow-lift">
			<h2 class="text-lg font-bold text-ink-900">{translate($lang, 'deleteStudent')}</h2>
			<p class="mt-2 text-sm text-ink-600">{deleteTarget.firstName} {deleteTarget.lastName} · {deleteTarget.studentId}</p>
			<p class="mt-4 text-sm text-red-700">{translate($lang, 'confirmDeleteStudent')}</p>
			<div class="mt-6 flex justify-end gap-2">
				<button type="button" onclick={() => (deleteTarget = null)} disabled={deleting} class="rounded-lg border border-ink-200 px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50">{translate($lang, 'cancel')}</button>
				<button type="button" onclick={confirmDelete} disabled={deleting} class="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">{deleting ? translate($lang, 'submitting') : translate($lang, 'delete')}</button>
			</div>
		</div>
	</div>
{/if}
