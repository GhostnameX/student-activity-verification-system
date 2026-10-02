<script lang="ts">
	import { onMount } from 'svelte';
	import { signOut } from '$lib/auth-client';
	import { user } from '$lib/auth';
	import { goto } from '$app/navigation';
	import { lang } from '$lib/store';
	import { translate } from '$lib/i18n';
	import { LoaderCircle } from 'lucide-svelte';

	onMount(async () => {
		try {
			await signOut();
		} finally {
			user.set(null);
			await goto('/auth/signin', { replaceState: true });
		}
	});
</script>

<div class="flex min-h-[calc(100vh-8rem)] items-center justify-center" aria-live="polite">
	<div class="flex items-center gap-3 text-sm font-medium text-ink-600">
		<LoaderCircle class="animate-spin text-brand-600" size={20} aria-hidden="true" />
		<span>{translate($lang, 'signingOut')}</span>
	</div>
</div>
