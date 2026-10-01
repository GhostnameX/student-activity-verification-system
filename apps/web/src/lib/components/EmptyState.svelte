<script lang="ts">
	import type { FileText } from 'lucide-svelte';
	import { Inbox } from 'lucide-svelte';

	interface Props {
		message: string;
		icon?: typeof FileText;
	}

	let { message, icon: Icon = Inbox }: Props = $props();
</script>

<div class="rounded-card border border-dashed border-ink-200 bg-surface/60 px-6 py-10 text-center">
	<Icon size={28} class="mx-auto mb-2 text-ink-400" aria-hidden="true" />
	<p class="text-sm text-ink-500">{message}</p>
</div>
