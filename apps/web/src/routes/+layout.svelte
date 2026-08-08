<script lang="ts">
	import { onMount } from 'svelte';
	import '../app.css';
	import { lang } from '$lib/store';
	import { user, loadSession } from '$lib/auth';
	import { translate, type Lang } from '$lib/i18n';
	import { Languages, GraduationCap, LogOut } from 'lucide-svelte';

	let { children } = $props();

	onMount(() => {
		loadSession();
	});

	function toggleLang() {
		lang.update((l) => (l === 'th' ? 'en' : 'th'));
	}
</script>

<svelte:head>
	<title>{translate($lang, 'appName')}</title>
</svelte:head>

<div class="flex min-h-screen flex-col bg-ink-50">
	<header class="sticky top-0 z-40 border-b border-ink-100 bg-white/80 backdrop-blur">
		<div class="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
			<a href="/" class="group flex items-center gap-2.5">
				<span
					class="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-soft transition-transform group-hover:scale-105"
				>
					<GraduationCap size={20} />
				</span>
				<span class="text-base font-bold tracking-tight text-ink-900">
					{translate($lang, 'appName')}
				</span>
			</a>
			<div class="flex items-center gap-2">
				<button
					onclick={toggleLang}
					class="flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm font-medium text-ink-700 transition hover:bg-ink-50"
					title={translate($lang, 'language')}
				>
					<Languages size={16} />
					{$lang === 'th' ? 'English' : 'ไทย'}
				</button>
				{#if $user}
					<span class="hidden text-sm font-medium text-ink-600 sm:inline">
						{$user.name}
					</span>
					<span
						class="hidden rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold capitalize text-brand-700 sm:inline"
					>
						{translate($lang, $user.role as 'student')}
					</span>
					<a
						href="/auth/signout"
						class="flex items-center gap-1.5 rounded-lg bg-ink-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-ink-800"
					>
						<LogOut size={15} />
						<span class="hidden sm:inline">{translate($lang, 'logout')}</span>
					</a>
				{:else}
					<a
						href="/auth/signin"
						class="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-medium text-white shadow-soft transition hover:bg-brand-700"
					>
						{translate($lang, 'login')}
					</a>
				{/if}
			</div>
		</div>
	</header>

	<main class="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
		{@render children()}
	</main>

	<footer class="border-t border-ink-100 bg-white py-6">
		<div class="mx-auto max-w-6xl px-4 text-center text-sm text-ink-400">
			{translate($lang, 'appName')} &middot; © {new Date().getFullYear()}
		</div>
	</footer>
</div>
