<script lang="ts">
	import { onMount } from 'svelte';
	import '../app.css';
	import { lang } from '$lib/store';
	import { user, loadSession } from '$lib/auth';
	import { translate, type Lang } from '$lib/i18n';
	import { Languages, GraduationCap, LogOut, FileText, Inbox, LayoutDashboard } from 'lucide-svelte';

	let { children } = $props();

	onMount(() => {
		loadSession();
	});

	function toggleLang() {
		lang.update((l) => (l === 'th' ? 'en' : 'th'));
	}

	const nav = $derived(
		[
			$user?.role === 'student'
				? { href: '/student', label: translate($lang, 'myRequests'), icon: FileText }
				: null,
			$user?.role === 'staff' || $user?.role === 'admin'
				? { href: '/staff', label: translate($lang, 'allRequests'), icon: Inbox }
				: null,
			$user?.role === 'admin'
				? { href: '/admin', label: translate($lang, 'dashboard'), icon: LayoutDashboard }
				: null,
		].filter((x): x is { href: string; label: string; icon: typeof FileText } => x !== null),
	);
</script>

<svelte:head>
	<title>{translate($lang, 'appName')}</title>
</svelte:head>

<div class="flex min-h-screen flex-col bg-ink-50">
	<header class="sticky top-0 z-40 border-b border-ink-100 bg-white/90 backdrop-blur">
		<div class="mx-auto flex h-16 max-w-[1600px] items-center justify-between gap-4 px-6 xl:px-10">
			<a href="/" class="group flex shrink-0 items-center gap-2.5">
				<span
					class="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-soft transition-transform group-hover:scale-105"
				>
					<GraduationCap size={22} />
				</span>
				<span class="text-lg font-bold tracking-tight text-ink-900">
					{translate($lang, 'appName')}
				</span>
			</a>

			{#if $user}
				<nav class="flex items-center gap-1 rounded-2xl border border-ink-100 bg-ink-50/60 p-1">
					{#each nav as item (item.href)}
						<a
							href={item.href}
							class="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-ink-600 transition hover:bg-white hover:text-ink-900 hover:shadow-soft"
						>
							<item.icon size={16} />
							<span class="hidden md:inline">{item.label}</span>
						</a>
					{/each}
				</nav>
			{/if}

			<div class="flex items-center gap-2.5">
				<button
					onclick={toggleLang}
					class="flex items-center gap-1.5 rounded-xl border border-ink-200 bg-white px-3.5 py-2 text-sm font-medium text-ink-700 transition hover:bg-ink-50"
					title={translate($lang, 'language')}
				>
					<Languages size={16} />
					{$lang === 'th' ? 'English' : 'ไทย'}
				</button>
				{#if $user}
					<div class="hidden items-center gap-2.5 lg:flex">
						<div class="text-right">
							<div class="text-sm font-semibold leading-tight text-ink-900">{$user.name}</div>
							<div class="text-xs capitalize text-ink-400">
								{translate($lang, $user.role as 'student')}
							</div>
						</div>
						<a
							href="/auth/signout"
							class="flex items-center gap-1.5 rounded-xl bg-ink-900 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-ink-800"
						>
							<LogOut size={15} />
							<span class="hidden xl:inline">{translate($lang, 'logout')}</span>
						</a>
					</div>
				{:else}
					<a
						href="/auth/signin"
						class="rounded-xl bg-brand-600 px-5 py-2 text-sm font-medium text-white shadow-soft transition hover:bg-brand-700"
					>
						{translate($lang, 'login')}
					</a>
				{/if}
			</div>
		</div>
	</header>

	<main class="mx-auto w-full max-w-[1600px] flex-1 px-6 py-8 xl:px-10">
		{@render children()}
	</main>

	<footer class="border-t border-ink-100 bg-white py-6">
		<div class="mx-auto max-w-[1600px] px-6 text-center text-sm text-ink-400 xl:px-10">
			{translate($lang, 'appName')} &middot; © {new Date().getFullYear()}
		</div>
	</footer>
</div>
