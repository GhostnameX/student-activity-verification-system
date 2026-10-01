<script lang="ts">
	import { lang } from '$lib/store';
	import { translate } from '$lib/i18n';
	import type { RequestStatus } from '$lib/api';

	let { status }: { status: RequestStatus } = $props();

	const classes: Record<RequestStatus, string> = {
		pending: 'bg-amber-50 text-amber-700 ring-amber-200',
		revision_required: 'bg-orange-50 text-orange-700 ring-orange-200',
		approved: 'bg-green-50 text-green-700 ring-green-200',
		rejected: 'bg-red-50 text-red-700 ring-red-200',
	};

	let label = $derived(
		status === 'revision_required' ? translate($lang, 'revisionRequired') : translate($lang, status),
	);
</script>

<span
	class="inline-flex whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ring-1 {classes[status]}"
>
	{label}
</span>
