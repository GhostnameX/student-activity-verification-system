<script lang="ts">
	import { lang } from '$lib/store';
	import { user } from '$lib/auth';
	import { translate } from '$lib/i18n';
	import { FileText, Inbox, LayoutDashboard, ShieldCheck } from 'lucide-svelte';

	const rolePath = {
		student: '/student',
		staff: '/staff',
		admin: '/admin',
	} as const;

	const roleIcon = {
		student: FileText,
		staff: Inbox,
		admin: LayoutDashboard,
	} as const;

	const roleAction = {
		student: 'myRequests',
		staff: 'allRequests',
		admin: 'dashboard',
	} as const;

	const path = $derived($user ? rolePath[$user.role as keyof typeof rolePath] : '/');
	const Icon = $derived($user ? roleIcon[$user.role as keyof typeof roleIcon] : FileText);
	const action = $derived($user ? roleAction[$user.role as keyof typeof roleAction] : 'myRequests');
</script>

<div class="mx-auto max-w-3xl">
	{#if $user}
		<div class="text-center">
			<div
				class="mb-6 inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-4 py-1.5 text-sm font-medium text-brand-700"
			>
				<ShieldCheck size={15} />
				{translate($lang, 'welcome')}, {$user.name}
			</div>
			<div class="mb-4 text-6xl">🎓</div>
			<h1 class="mb-3 text-4xl font-extrabold tracking-tight text-ink-900">
				{translate($lang, 'appName')}
			</h1>
			<p class="mb-10 text-lg text-ink-500">{translate($lang, 'tagline')}</p>

			<a
				href={path}
				class="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-8 py-3 font-medium text-white shadow-lift transition hover:-translate-y-0.5 hover:bg-brand-700"
			>
				<Icon size={18} />
				{translate($lang, action)}
			</a>
		</div>
	{:else}
		<div class="text-center">
			<div
				class="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-brand-500 to-brand-700 text-4xl text-white shadow-lift"
			>
				🎓
			</div>
			<h1 class="mb-3 text-4xl font-extrabold tracking-tight text-ink-900">
				{translate($lang, 'appName')}
			</h1>
			<p class="mb-10 text-lg text-ink-500">{translate($lang, 'tagline')}</p>

			<div class="flex flex-wrap items-center justify-center gap-3">
				<a
					href="/auth/signin"
					class="rounded-xl bg-brand-600 px-8 py-3 font-medium text-white shadow-lift transition hover:-translate-y-0.5 hover:bg-brand-700"
				>
					{translate($lang, 'login')}
				</a>
				<a
					href="/auth/signup"
					class="rounded-xl border border-ink-200 bg-white px-8 py-3 font-medium text-ink-700 transition hover:-translate-y-0.5 hover:bg-ink-50"
				>
					{translate($lang, 'signUp')}
				</a>
			</div>
		</div>
	{/if}
</div>
