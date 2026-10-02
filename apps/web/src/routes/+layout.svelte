<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import '../app.css';
	import { lang, dark } from '$lib/store';
	import { user, loadSession } from '$lib/auth';
	import { translate, type Lang } from '$lib/i18n';
	import { bangkokYear, formatBangkokDateTime } from '$lib/datetime';
	import {
		Languages,
		GraduationCap,
		LogOut,
		FileText,
		Inbox,
		LayoutDashboard,
		ClipboardList,
		Bell,
		CheckCheck,
		User,
		Moon,
		Sun,
		Menu,
		X,
		BadgeCheck,
		ChevronDown,
	} from 'lucide-svelte';
	import {
		getNotifications,
		markAllNotificationsRead,
		markNotificationRead,
		avatarUrl,
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
	let mobileNavOpen = $state(false);
	let userMenuOpen = $state(false);

	function handleWindowClick(event: MouseEvent) {
		if (!(event.target as Element | null)?.closest('[data-user-menu]')) userMenuOpen = false;
	}

	function isNavActive(href: string) {
		return page.url.pathname === href || page.url.pathname.startsWith(`${href}/`);
	}

	function closeMobileNav() {
		mobileNavOpen = false;
	}

	function handleWindowKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			closeMobileNav();
			userMenuOpen = false;
		}
	}

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
			$user?.role === 'admin'
				? { href: '/staff', label: translate($lang, 'allRequests'), icon: Inbox }
				: null,
			$user?.role === 'staff'
				? { href: '/review', label: translate($lang, 'staffReviewTitle'), icon: BadgeCheck }
				: null,
			$user?.role === 'staff' || $user?.role === 'admin'
				? { href: '/stats', label: translate($lang, 'submissionStats'), icon: LayoutDashboard }
				: null,
			$user?.role === 'staff' || $user?.role === 'admin'
				? { href: '/roster', label: translate($lang, 'rosterManagement'), icon: ClipboardList }
				: null,
			$user?.role === 'admin'
				? { href: '/admin', label: translate($lang, 'dashboard'), icon: LayoutDashboard }
				: null,
			$user ? { href: '/profile', label: translate($lang, 'profile'), icon: User } : null,
		].filter((x): x is { href: string; label: string; icon: typeof FileText } => x !== null),
	);

	// Profile lives in the user menu on desktop, so the top bar keeps one line of links.
	const desktopNav = $derived(nav.filter((item) => item.href !== '/profile'));
</script>

<svelte:window onkeydown={handleWindowKeydown} onclick={handleWindowClick} />

<svelte:head>
	<title>{translate($lang, 'appName')}</title>
</svelte:head>

<div class="flex min-h-screen flex-col bg-ink-50">
	<header class="sticky top-0 z-40 border-b border-ink-100 bg-surface/90 backdrop-blur">
		<div class="mx-auto flex h-16 max-w-[1600px] items-center justify-between gap-2 px-4 sm:gap-4 sm:px-6 xl:px-10">
			<a href="/" class="group flex min-w-0 items-center gap-2.5" aria-label={translate($lang, 'appName')}>
				<span
					class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-soft transition-transform group-hover:scale-105"
				>
					<GraduationCap size={22} />
				</span>
				<span
					class="min-w-0 truncate text-lg font-bold tracking-tight text-ink-900 {$user ? 'hidden 2xl:block' : 'max-sm:hidden'}"
				>
					{translate($lang, 'appName')}
				</span>
			</a>

			{#if $user}
				<nav
					class="hidden min-w-0 items-center gap-1 rounded-2xl border border-ink-100 bg-ink-50/60 p-1 md:flex"
					aria-label="Main navigation"
				>
					{#each desktopNav as item (item.href)}
						<a
							href={item.href}
							title={item.label}
							aria-label={item.label}
							aria-current={isNavActive(item.href) ? 'page' : undefined}
							class="flex min-h-10 items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition hover:bg-surface hover:text-ink-900 hover:shadow-soft {isNavActive(item.href)
								? 'bg-surface text-brand-700 shadow-soft'
								: 'text-ink-600'}"
						>
							<item.icon size={16} aria-hidden="true" />
							<span class="hidden lg:inline">{item.label}</span>
						</a>
					{/each}
				</nav>
			{/if}

			<div class="flex items-center gap-1.5 sm:gap-2.5">
				{#if $user}
					<button
						onclick={() => (mobileNavOpen = !mobileNavOpen)}
						class="flex h-11 w-11 items-center justify-center rounded-xl border border-ink-200 bg-surface text-ink-700 transition hover:bg-ink-50 md:hidden"
						aria-label={mobileNavOpen ? 'Close navigation' : 'Open navigation'}
						aria-expanded={mobileNavOpen}
						aria-controls="mobile-navigation"
					>
						{#if mobileNavOpen}
							<X size={18} />
						{:else}
							<Menu size={18} />
						{/if}
					</button>
				{/if}
				{#if $user}
					<div class="relative">
						<button
							onclick={openBell}
							class="relative flex h-11 w-11 items-center justify-center rounded-xl border border-ink-200 md:h-10 md:w-10 bg-surface text-ink-700 transition hover:bg-ink-50"
							aria-label={translate($lang, 'notifications')}
						>
							<Bell size={16} />
							{#if unread > 0}
								<span
									class="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rejected-soft0 px-1 text-[10px] font-bold text-white"
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
													{formatBangkokDateTime(n.createdAt, $lang)}
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
					class="flex h-11 items-center gap-1.5 rounded-xl border border-ink-200 bg-surface px-3 text-sm font-medium text-ink-700 transition hover:bg-ink-50 md:h-10 xl:px-3.5"
					title={translate($lang, 'language')}
					aria-label={translate($lang, 'language')}
				>
					<Languages size={16} />
					<span class="max-xl:hidden">{$lang === 'th' ? 'English' : 'ไทย'}</span>
				</button>
				<button
					onclick={toggleTheme}
					class="flex h-11 w-11 items-center justify-center rounded-xl border border-ink-200 bg-surface text-ink-700 transition hover:bg-ink-50 max-sm:hidden md:h-10 md:w-10"
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
					<div class="relative hidden md:block" data-user-menu>
						<button
							type="button"
							onclick={() => (userMenuOpen = !userMenuOpen)}
							aria-expanded={userMenuOpen}
							aria-label={$user.name}
							class="flex h-10 items-center gap-2 rounded-xl border border-ink-200 bg-surface py-1 pl-1 pr-2.5 transition hover:bg-ink-50"
						>
							{#if $user.avatarUrl}
								<img
									src={avatarUrl($user.avatarUrl)}
									alt=""
									class="h-8 w-8 rounded-lg border border-ink-100 object-cover"
								/>
							{:else}
								<span
									class="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-bold text-white"
								>
									{$user.name.trim().charAt(0).toUpperCase()}
								</span>
							{/if}
							<span class="hidden max-w-40 truncate text-sm font-semibold text-ink-900 xl:block">
								{$user.name}
							</span>
							<ChevronDown size={15} class="text-ink-500" aria-hidden="true" />
						</button>
						{#if userMenuOpen}
							<div
								class="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-ink-100 bg-surface shadow-lift"
							>
								<div class="border-b border-ink-100 px-4 py-3">
									<p class="break-words text-sm font-semibold text-ink-900">{$user.name}</p>
									<p class="mt-0.5 text-xs capitalize text-ink-500">
										{translate($lang, $user.role as 'student')}
									</p>
								</div>
								<a
									href="/profile"
									onclick={() => (userMenuOpen = false)}
									class="flex min-h-11 items-center gap-2.5 px-4 py-2.5 text-sm font-medium text-ink-700 transition hover:bg-ink-50"
								>
									<User size={16} aria-hidden="true" />
									{translate($lang, 'profile')}
								</a>
								<a
									href="/auth/signout"
									class="flex min-h-11 items-center gap-2.5 px-4 py-2.5 text-sm font-medium text-rejected transition hover:bg-rejected-soft"
								>
									<LogOut size={16} aria-hidden="true" />
									{translate($lang, 'logout')}
								</a>
							</div>
						{/if}
					</div>
				{:else}
					<a
						href="/auth/signin"
						class="rounded-xl bg-brand-solid px-3.5 py-2 text-sm font-medium text-white shadow-soft transition hover:bg-brand-solid-hover sm:px-5"
					>
						{translate($lang, 'login')}
					</a>
				{/if}
			</div>
		</div>
	</header>

	{#if $user}
		<button
			class={`fixed inset-x-0 bottom-0 top-16 z-40 bg-ink-900/30 backdrop-blur-[1px] transition-opacity duration-200 md:hidden ${
				mobileNavOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
			}`}
			onclick={closeMobileNav}
			aria-label="Close navigation"
			tabindex={mobileNavOpen ? 0 : -1}
		></button>
		<aside
			id="mobile-navigation"
			class={`fixed bottom-0 left-0 top-16 z-50 flex w-[min(82vw,20rem)] flex-col border-r border-ink-100 bg-surface shadow-lift transition-transform duration-200 ease-out md:hidden ${
				mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
			}`}
			aria-label="Mobile navigation"
			aria-hidden={!mobileNavOpen}
			inert={!mobileNavOpen}
		>
			<nav class="flex flex-1 flex-col gap-1 overflow-y-auto p-4">
				{#each nav as item (item.href)}
					<a
						href={item.href}
						onclick={closeMobileNav}
						aria-current={isNavActive(item.href) ? 'page' : undefined}
						class={`flex min-h-12 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
							isNavActive(item.href)
								? 'bg-brand-50 text-brand-700'
								: 'text-ink-600 hover:bg-ink-50 hover:text-ink-900'
						}`}
					>
						<item.icon size={19} />
						<span class="min-w-0 truncate">{item.label}</span>
					</a>
				{/each}
			</nav>
			<div class="space-y-1 border-t border-ink-100 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
				{#if $user}
					<div class="px-3 pb-2">
						<p class="break-words text-sm font-semibold text-ink-900">{$user.name}</p>
						<p class="text-xs capitalize text-ink-500">{translate($lang, $user.role as 'student')}</p>
					</div>
				{/if}
				<button
					type="button"
					onclick={toggleTheme}
					class="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-ink-600 transition hover:bg-ink-50 sm:hidden"
				>
					{#if $dark}<Sun size={19} aria-hidden="true" />{:else}<Moon size={19} aria-hidden="true" />{/if}
					<span>{$dark ? 'Light mode' : 'Dark mode'}</span>
				</button>
				<a
					href="/auth/signout"
					class="flex min-h-12 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-rejected transition hover:bg-rejected-soft"
				>
					<LogOut size={19} />
					<span>{translate($lang, 'logout')}</span>
				</a>
			</div>
		</aside>
	{/if}

	<main class="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 sm:px-6 sm:py-8 xl:px-10">
		{@render children()}
	</main>

	<footer class="border-t border-ink-100 bg-surface py-6">
		<div class="mx-auto max-w-[1600px] px-4 text-center text-sm text-ink-500 sm:px-6 xl:px-10">
			<div>{translate($lang, 'appName')} &middot; © {bangkokYear()}</div>
			<div class="mt-1 text-xs text-ink-500">
				Built by
				<a
					href="https://github.com/GhostnameX"
					target="_blank"
					rel="noopener noreferrer"
					class="transition hover:text-ink-500 hover:underline"
				>
					@GhostnameX
				</a>
			</div>
		</div>
	</footer>
</div>
