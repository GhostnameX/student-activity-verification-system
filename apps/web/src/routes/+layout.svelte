<script lang="ts">
	import { onMount } from 'svelte';
	import '../app.css';
	import { lang, dark } from '$lib/store';
	import { user, loadSession } from '$lib/auth';
	import { translate, type Lang } from '$lib/i18n';
	import {
		Languages,
		GraduationCap,
		LogOut,
		FileText,
		Inbox,
		LayoutDashboard,
		Bell,
		CheckCheck,
		User,
		Moon,
		Sun,
	} from 'lucide-svelte';
	import {
		getNotifications,
		markAllNotificationsRead,
		markNotificationRead,
		type NotificationItem,
	} from '$lib/api';

	let { children } = $props();

	onMount(() => {
		loadSession();
	});

	function toggleLang() {
		lang.update((l) => (l === 'th' ? 'en' : 'th'));
	}

	function toggleTheme() {
		dark.update((d) => !d);
	}

	let notifications: NotificationItem[] = $state([]);
	let bellOpen = $state(false);

	$effect(() => {
		if ($user) {
			loadNotifications();
		}
	});

	async function loadNotifications() {
		try {
			notifications = await getNotifications();
		} catch {
			notifications = [];
		}
	}

	let unread = $derived(notifications.filter((n) => !n.readAt).length);

	async function openBell() {
		bellOpen = !bellOpen;
		if (bellOpen) {
			await loadNotifications();
		}
	}

	async function markRead(n: NotificationItem) {
		if (n.readAt) return;
		await markNotificationRead(n.id);
		notifications = notifications.map((x) =>
			x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x,
		);
	}

	async function markAll() {
		await markAllNotificationsRead();
		notifications = notifications.map((x) => ({
			...x,
			readAt: new Date().toISOString(),
		}));
	}

	const nav = $derived(
		[
			$user?.role === 'student'
				? { href: '/student', label: translate($lang, 'myRequests'), icon: FileText }
				: null,
			$user?.role === 'staff' || $user?.role === 'admin'
				? { href: '/staff', label: translate($lang, 'allRequests'), icon: Inbox }
				: null,
			$user?.role === 'staff' || $user?.role === 'admin'
				? { href: '/stats', label: translate($lang, 'submissionStats'), icon: LayoutDashboard }
				: null,
			$user?.role === 'admin'
				? { href: '/admin', label: translate($lang, 'dashboard'), icon: LayoutDashboard }
				: null,
			$user ? { href: '/profile', label: translate($lang, 'profile'), icon: User } : null,
		].filter((x): x is { href: string; label: string; icon: typeof FileText } => x !== null),
	);
</script>

<svelte:head>
	<title>{translate($lang, 'appName')}</title>
</svelte:head>

<div class="flex min-h-screen flex-col bg-ink-50">
	<header class="sticky top-0 z-40 border-b border-ink-100 bg-surface/90 backdrop-blur">
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
							class="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-ink-600 transition hover:bg-surface hover:text-ink-900 hover:shadow-soft"
						>
							<item.icon size={16} />
							<span class="hidden md:inline">{item.label}</span>
						</a>
					{/each}
				</nav>
			{/if}

			<div class="flex items-center gap-2.5">
				{#if $user}
					<div class="relative">
						<button
							onclick={openBell}
							class="relative flex h-9 w-9 items-center justify-center rounded-xl border border-ink-200 bg-surface text-ink-700 transition hover:bg-ink-50"
							aria-label={translate($lang, 'notifications')}
						>
							<Bell size={16} />
							{#if unread > 0}
								<span
									class="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white"
								>
									{unread > 99 ? '99+' : unread}
								</span>
							{/if}
						</button>

						{#if bellOpen}
							<div
								class="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-2xl border border-ink-100 bg-surface shadow-lift"
							>
								<div class="flex items-center justify-between border-b border-ink-100 px-4 py-3">
									<p class="text-sm font-semibold text-ink-900">
										{translate($lang, 'notifications')}
									</p>
									{#if unread > 0}
										<button
											onclick={markAll}
											class="flex items-center gap-1 text-xs font-medium text-brand-600 transition hover:text-brand-700"
										>
											<CheckCheck size={14} />
											{translate($lang, 'markAllRead')}
										</button>
									{/if}
								</div>
								<div class="max-h-96 overflow-y-auto">
									{#if notifications.length === 0}
										<p class="px-4 py-8 text-center text-sm text-ink-500">
											{translate($lang, 'noNotifications')}
										</p>
									{:else}
										{#each notifications as n (n.id)}
											<button
												onclick={() => markRead(n)}
												class={`block w-full border-b border-ink-50 px-4 py-3 text-left transition last:border-0 hover:bg-ink-50/60 ${
													n.readAt ? 'opacity-60' : ''
												}`}
											>
												<div class="flex items-start justify-between gap-2">
													<p class="text-sm font-medium text-ink-900">{n.title}</p>
													{#if !n.readAt}
														<span class="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand-500"></span>
													{/if}
												</div>
												<p class="mt-0.5 line-clamp-2 text-xs text-ink-500">{n.body}</p>
												<p class="mt-1 text-[10px] uppercase tracking-wide text-ink-400">
													{new Date(n.createdAt).toLocaleString($lang === 'th' ? 'th-TH' : 'en-US')}
												</p>
											</button>
										{/each}
									{/if}
								</div>
							</div>
						{/if}
					</div>
				{/if}

				<button
					onclick={toggleLang}
					class="flex items-center gap-1.5 rounded-xl border border-ink-200 bg-surface px-3.5 py-2 text-sm font-medium text-ink-700 transition hover:bg-ink-50"
					title={translate($lang, 'language')}
				>
					<Languages size={16} />
					{$lang === 'th' ? 'English' : 'ไทย'}
				</button>
				<button
					onclick={toggleTheme}
					class="flex h-9 w-9 items-center justify-center rounded-xl border border-ink-200 bg-surface text-ink-700 transition hover:bg-ink-50"
					aria-label="Toggle dark mode"
					title="Dark mode"
				>
					{#if $dark}
						<Sun size={16} />
					{:else}
						<Moon size={16} />
					{/if}
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
							class="flex items-center gap-1.5 rounded-xl bg-ink-900 px-3.5 py-2 text-sm font-medium text-ink-50 transition hover:bg-ink-800"
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

	<footer class="border-t border-ink-100 bg-surface py-6">
		<div class="mx-auto max-w-[1600px] px-6 text-center text-sm text-ink-400 xl:px-10">
			{translate($lang, 'appName')} &middot; © {new Date().getFullYear()}
		</div>
	</footer>
</div>
