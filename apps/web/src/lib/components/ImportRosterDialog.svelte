<script lang="ts">
	import { lang } from '$lib/store';
	import { translate, type TKey } from '$lib/i18n';
	import {
		commitRosterImport,
		previewRosterImport,
		RosterImportApiError,
		type RosterImportClassification,
		type RosterImportCommitResult,
		type RosterImportPreview,
		type RosterImportRow,
	} from '$lib/api';
	import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, FileSpreadsheet, Upload, X } from 'lucide-svelte';

	let { open, onclose, oncommitted }: {
		open: boolean;
		onclose: () => void;
		oncommitted: () => void | Promise<void>;
	} = $props();

	const pageSize = 20;
	const classifications: Array<'' | RosterImportClassification> = ['', 'new', 'update', 'unchanged', 'conflict', 'invalid'];
	let fileInput = $state<HTMLInputElement>();
	let file: File | null = $state(null);
	let preview = $state<RosterImportPreview | null>(null);
	let result = $state<RosterImportCommitResult | null>(null);
	let busy = $state(false);
	let error = $state('');
	let filter: '' | RosterImportClassification = $state('');
	let page = $state(1);

	let filteredRows: RosterImportRow[] = $derived.by(() => {
		const current = preview;
		if (!current) return [];
		return filter ? current.rows.filter((row) => row.classification === filter) : current.rows;
	});
	let totalPages = $derived(Math.max(1, Math.ceil(filteredRows.length / pageSize)));
	let visibleRows = $derived(filteredRows.slice((page - 1) * pageSize, page * pageSize));
	let canCommit = $derived.by(() => {
		const current = preview;
		return Boolean(current && current.status === 'validated' && current.summary.conflicts === 0 && current.summary.invalid === 0);
	});

	function reset() {
		file = null;
		preview = null;
		result = null;
		error = '';
		filter = '';
		page = 1;
		if (fileInput) fileInput.value = '';
	}

	function close() {
		if (busy) return;
		reset();
		onclose();
	}

	function chooseFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		file = input.files?.[0] ?? null;
		preview = null;
		result = null;
		error = '';
	}

	function errorLabel(code: string): string {
		const mapping: Record<string, TKey> = {
			file_required: 'importFileRequired',
			file_too_large: 'importFileTooLarge',
			unsupported_file_type: 'importUnsupportedType',
			unsupported_csv_encoding: 'importEncodingError',
			malformed_csv: 'importMalformedFile',
			malformed_xlsx: 'importMalformedFile',
			invalid_xlsx_signature: 'importMalformedFile',
			formula_cells_not_supported: 'importFormulaRejected',
			missing_required_headers: 'importMissingHeaders',
			ambiguous_headers: 'importAmbiguousHeaders',
			too_many_rows: 'importTooManyRows',
			too_many_worksheets: 'importTooManySheets',
			stale_preview: 'importStalePreview',
			import_batch_already_committed: 'importAlreadyCommitted',
			import_batch_not_committable: 'importBlocked',
		};
		return translate($lang, mapping[code] ?? 'importRequestError');
	}

	function apiErrorText(cause: RosterImportApiError): string {
		const base = errorLabel(cause.code);
		const fields = cause.details.fields;
		return Array.isArray(fields) && fields.every((field) => typeof field === 'string')
			? `${base}: ${fields.join(', ')}`
			: base;
	}

	function issueLabel(code: string): string {
		const mapping: Record<string, TKey> = {
			duplicate_student_id_in_file: 'importDuplicateId',
			duplicate_email_in_file: 'importDuplicateEmail',
			invalid_phone: 'importInvalidPhone',
			invalid_status: 'importInvalidStatus',
			existing_student_soft_deleted: 'importSoftDeletedConflict',
			bound_email_readonly: 'importBoundEmailConflict',
			email_conflicts_with_existing_student: 'importDbEmailConflict',
		};
		if (code.startsWith('missing_')) return translate($lang, 'importMissingValue');
		return translate($lang, mapping[code] ?? 'importInvalidValue');
	}

	function classificationLabel(value: RosterImportClassification): string {
		return translate($lang, ({
			new: 'importNew', update: 'importUpdates', unchanged: 'importUnchanged',
			conflict: 'importConflicts', invalid: 'importInvalid',
		} as const)[value]);
	}

	function classificationClass(value: RosterImportClassification): string {
		if (value === 'new') return 'bg-green-50 text-green-700 ring-green-200';
		if (value === 'update') return 'bg-brand-50 text-brand-700 ring-brand-200';
		if (value === 'unchanged') return 'bg-ink-50 text-ink-600 ring-ink-200';
		return value === 'conflict' ? 'bg-amber-50 text-amber-800 ring-amber-200' : 'bg-red-50 text-red-700 ring-red-200';
	}

	function valueText(value: unknown): string {
		if (value === null || value === undefined || value === '') return '—';
		return String(value);
	}

	function reviewFields(row: RosterImportRow) {
		if (!row.proposed) return [];
		const fields = row.classification === 'new'
			? Object.keys(row.proposed)
			: row.changedFields;
		return fields.map((field) => ({
			field,
			current: valueText(row.current?.[field as keyof typeof row.current]),
			proposed: valueText(row.proposed?.[field as keyof typeof row.proposed]),
		}));
	}

	async function createPreview() {
		if (!file) {
			error = translate($lang, 'importFileRequired');
			return;
		}
		busy = true;
		error = '';
		try {
			preview = await previewRosterImport(file);
			filter = '';
			page = 1;
		} catch (cause) {
			error = cause instanceof RosterImportApiError ? apiErrorText(cause) : translate($lang, 'importRequestError');
		} finally {
			busy = false;
		}
	}

	async function confirmImport() {
		if (!preview || !canCommit) return;
		busy = true;
		error = '';
		try {
			result = await commitRosterImport(preview.batchId);
			await oncommitted();
		} catch (cause) {
			error = cause instanceof RosterImportApiError ? apiErrorText(cause) : translate($lang, 'importCommitError');
		} finally {
			busy = false;
		}
	}

	function applyFilter(value: '' | RosterImportClassification) {
		filter = value;
		page = 1;
	}
</script>

{#if open}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-5" role="dialog" aria-modal="true" aria-labelledby="import-roster-title" tabindex="-1" onkeydown={(event) => { if (event.key === 'Escape') close(); }}>
		<div class="flex max-h-[94vh] w-full max-w-6xl min-w-0 flex-col overflow-hidden rounded-lg bg-surface shadow-xl">
			<header class="flex items-center justify-between border-b border-ink-100 px-4 py-3 sm:px-6">
				<div class="min-w-0">
					<h2 id="import-roster-title" class="truncate text-lg font-bold text-ink-900 sm:text-xl">{translate($lang, 'importStudents')}</h2>
					<p class="mt-0.5 text-xs text-ink-500 sm:text-sm">{translate($lang, 'importFileHelp')}</p>
				</div>
				<button type="button" onclick={close} disabled={busy} class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-50 disabled:opacity-40" aria-label={translate($lang, 'cancel')}><X size={20} /></button>
			</header>

			<div class="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
				{#if result}
					<div class="py-10 text-center">
						<CheckCircle2 size={48} class="mx-auto text-green-600" />
						<h3 class="mt-4 text-xl font-bold text-ink-900">{translate($lang, 'importSuccess')}</h3>
						<p class="mt-2 text-sm text-ink-600">
							{translate($lang, 'importResultSummary').replace('{created}', String(result.created)).replace('{updated}', String(result.updated)).replace('{unchanged}', String(result.unchanged))}
						</p>
					</div>
				{:else if !preview}
					<input bind:this={fileInput} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onchange={chooseFile} class="sr-only" />
					<button type="button" onclick={() => fileInput?.click()} class="flex min-h-48 w-full flex-col items-center justify-center border-2 border-dashed border-ink-200 px-6 py-8 text-center hover:border-brand-400 hover:bg-brand-50/30">
						<FileSpreadsheet size={36} class="text-brand-600" />
						<span class="mt-3 font-semibold text-ink-900">{file?.name ?? translate($lang, 'chooseImportFile')}</span>
						<span class="mt-1 text-xs text-ink-500">CSV/XLSX · 5 MB · 500 {translate($lang, 'studentsUnit')}</span>
					</button>
				{:else}
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div class="min-w-0">
							<p class="truncate font-semibold text-ink-900">{preview.fileName}</p>
							<p class="text-xs text-ink-500">{translate($lang, 'importPreview')}</p>
						</div>
						<button type="button" onclick={reset} disabled={busy} class="text-sm font-semibold text-brand-700 hover:text-brand-800">{translate($lang, 'replaceImportFile')}</button>
					</div>

					<div class="mt-4 grid grid-cols-2 border border-ink-100 sm:grid-cols-3 lg:grid-cols-6">
						{#each [
							['importNew', preview.summary.new, 'text-green-700'], ['importUpdates', preview.summary.updates, 'text-brand-700'],
							['importUnchanged', preview.summary.unchanged, 'text-ink-600'], ['importConflicts', preview.summary.conflicts, 'text-amber-700'],
							['importInvalid', preview.summary.invalid, 'text-red-700'], ['importTotal', preview.summary.total, 'text-ink-900']
						] as metric}
							<div class="border-b border-r border-ink-100 p-3 last:border-r-0 sm:p-4">
								<p class="text-xs text-ink-500">{translate($lang, metric[0] as TKey)}</p>
								<p class={`mt-1 text-xl font-bold ${metric[2]}`}>{metric[1]}</p>
							</div>
						{/each}
					</div>

					{#if preview.ignoredHeaders.length > 0}
						<p class="mt-3 text-xs text-amber-700">{translate($lang, 'importIgnoredHeaders')}: {preview.ignoredHeaders.join(', ')}</p>
					{/if}
					{#if !canCommit}
						<div class="mt-3 flex gap-2 border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900"><AlertTriangle size={18} class="shrink-0" />{translate($lang, 'importBlocked')}</div>
					{/if}

					<div class="mt-4 flex gap-2 overflow-x-auto pb-1">
						{#each classifications as value}
							<button type="button" onclick={() => applyFilter(value)} class={`shrink-0 rounded-lg px-3 py-2 text-sm font-semibold ${filter === value ? 'bg-ink-900 text-white' : 'bg-ink-50 text-ink-600 hover:bg-ink-100'}`}>
								{value ? classificationLabel(value) : translate($lang, 'importReviewAll')}
							</button>
						{/each}
					</div>

					<div class="mt-3 hidden overflow-x-auto border-y border-ink-100 md:block">
						<table class="w-full min-w-[760px] text-left text-sm">
							<thead class="bg-ink-50 text-xs text-ink-500"><tr><th class="px-3 py-2">#</th><th class="px-3 py-2">{translate($lang, 'studentId')}</th><th class="px-3 py-2">{translate($lang, 'classification')}</th><th class="px-3 py-2">{translate($lang, 'importChanges')}</th><th class="px-3 py-2">{translate($lang, 'importIssues')}</th></tr></thead>
							<tbody class="divide-y divide-ink-100">
								{#each visibleRows as row}
									<tr class="align-top"><td class="px-3 py-3 font-mono text-xs">{row.rowNumber}</td><td class="px-3 py-3 font-mono">{row.studentId ?? '—'}</td><td class="px-3 py-3"><span class={`rounded px-2 py-1 text-xs font-semibold ring-1 ${classificationClass(row.classification)}`}>{classificationLabel(row.classification)}</span></td><td class="px-3 py-3 text-xs"><ul class="space-y-1">{#each reviewFields(row) as change}<li><b>{change.field}</b>: {change.current} → {change.proposed}</li>{/each}</ul></td><td class="px-3 py-3 text-xs text-red-700"><ul>{#each row.errors as issue}<li>{issueLabel(issue)}</li>{/each}</ul></td></tr>
								{/each}
							</tbody>
						</table>
					</div>

					<div class="mt-3 space-y-2 md:hidden">
						{#each visibleRows as row}
							<article class="min-w-0 border border-ink-100 p-3">
								<div class="flex min-w-0 items-center justify-between gap-2"><span class="min-w-0 truncate font-mono text-sm">{row.studentId ?? `#${row.rowNumber}`}</span><span class={`shrink-0 rounded px-2 py-1 text-xs font-semibold ring-1 ${classificationClass(row.classification)}`}>{classificationLabel(row.classification)}</span></div>
								<ul class="mt-2 space-y-1 break-words text-xs text-ink-600">{#each reviewFields(row) as change}<li><b>{change.field}</b>: {change.current} → {change.proposed}</li>{/each}</ul>
								<ul class="mt-2 space-y-1 text-xs text-red-700">{#each row.errors as issue}<li>{issueLabel(issue)}</li>{/each}</ul>
							</article>
						{/each}
					</div>

					<div class="mt-4 flex items-center justify-between gap-3 text-sm">
						<span>{translate($lang, 'pageInfo').replace('{page}', String(page)).replace('{total}', String(totalPages))}</span>
						<div class="flex gap-2"><button type="button" onclick={() => (page = Math.max(1, page - 1))} disabled={page === 1} class="flex h-9 w-9 items-center justify-center rounded-lg border border-ink-200 disabled:opacity-40"><ChevronLeft size={16} /></button><button type="button" onclick={() => (page = Math.min(totalPages, page + 1))} disabled={page === totalPages} class="flex h-9 w-9 items-center justify-center rounded-lg border border-ink-200 disabled:opacity-40"><ChevronRight size={16} /></button></div>
					</div>
				{/if}

				{#if error}<div class="mt-4 border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700">{error}</div>{/if}
			</div>

			<footer class="flex flex-wrap justify-end gap-2 border-t border-ink-100 px-4 py-3 sm:px-6">
				<button type="button" onclick={close} disabled={busy} class="rounded-lg border border-ink-200 px-4 py-2 text-sm font-semibold text-ink-700 hover:bg-ink-50 disabled:opacity-40">{result ? translate($lang, 'importClose') : translate($lang, 'cancel')}</button>
				{#if !preview && !result}<button type="button" onclick={createPreview} disabled={!file || busy} class="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40"><Upload size={16} />{busy ? translate($lang, 'submitting') : translate($lang, 'previewImport')}</button>{/if}
				{#if preview && !result}<button type="button" onclick={confirmImport} disabled={!canCommit || busy} class="rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-40">{busy ? translate($lang, 'submitting') : translate($lang, 'confirmImport')}</button>{/if}
			</footer>
		</div>
	</div>
{/if}
