<script lang="ts">
	import { lang } from '$lib/store';
	import { user } from '$lib/auth';
	import { translate } from '$lib/i18n';
	import {
		FileText,
		LayoutDashboard,
		ShieldCheck,
		Clock,
		UploadCloud,
		CheckCircle2,
		GraduationCap,
	} from 'lucide-svelte';

	const rolePath = {
		student: '/student',
		staff: '/stats',
		admin: '/admin',
	} as const;

	const roleIcon = {
		student: FileText,
		staff: LayoutDashboard,
		admin: LayoutDashboard,
	} as const;

	const roleAction = {
		student: 'myRequests',
		staff: 'submissionStats',
		admin: 'dashboard',
	} as const;

	const path = $derived($user ? rolePath[$user.role as keyof typeof rolePath] : '/');
	const Icon = $derived($user ? roleIcon[$user.role as keyof typeof roleIcon] : FileText);
	const action = $derived($user ? roleAction[$user.role as keyof typeof roleAction] : 'myRequests');

	const features = [
		{ icon: FileText, title: 'myRequests', desc: 'submitRequest' },
		{ icon: Clock, title: 'totalPending', desc: 'submittedAt' },
		{ icon: CheckCircle2, title: 'totalApproved', desc: 'status' },
		{ icon: UploadCloud, title: 'uploadImages', desc: 'attachments' },
	];
</script>

{#if $user}
	<div class="mx-auto max-w-4xl text-center">
		<div
			class="mb-6 inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-5 py-2 text-sm font-medium text-brand-700"
		>
			<ShieldCheck size={15} />
			{translate($lang, 'welcome')}, {$user.name}
		</div>
		<div class="mb-6 text-7xl">🎓</div>
		<h1 class="mb-4 text-5xl font-extrabold tracking-tight text-ink-900">
			{translate($lang, 'appName')}
		</h1>
		<p class="mb-10 text-xl text-ink-500">{translate($lang, 'tagline')}</p>

		<a
			href={path}
			class="inline-flex items-center gap-2.5 rounded-2xl bg-brand-600 px-10 py-4 text-lg font-medium text-white shadow-lift transition hover:-translate-y-0.5 hover:bg-brand-700"
		>
			<Icon size={20} />
			{translate($lang, action)}
		</a>
	</div>
{:else}
	<div class="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:items-center lg:gap-16">
		<div class="text-center lg:text-left">
			<div
				class="mx-auto mb-8 flex h-24 w-24 items-center justify-center rounded-[2rem] bg-gradient-to-br from-brand-500 to-brand-700 text-5xl text-white shadow-lift lg:mx-0"
			>
				<GraduationCap size={44} />
			</div>
			<h1 class="mb-4 text-5xl font-extrabold leading-tight tracking-tight text-ink-900 xl:text-6xl">
				{translate($lang, 'appName')}
			</h1>
			<p class="mb-10 text-xl text-ink-500 xl:text-2xl">{translate($lang, 'tagline')}</p>

			<div class="flex flex-wrap items-center justify-center gap-4 lg:justify-start">
				<a
					href="/auth/signin"
					class="rounded-2xl bg-brand-600 px-9 py-4 text-base font-semibold text-white shadow-lift transition hover:-translate-y-0.5 hover:bg-brand-700"
				>
					{translate($lang, 'login')}
				</a>
				<a
					href="/auth/signin?mode=signup"
					class="rounded-2xl border border-ink-200 bg-surface px-9 py-4 text-base font-semibold text-ink-700 transition hover:-translate-y-0.5 hover:bg-ink-50"
				>
					{translate($lang, 'signUp')}
				</a>
			</div>
		</div>

		<div class="grid grid-cols-1 gap-5 sm:grid-cols-2">
			{#each features as f (f.title)}
				<div
					class="rounded-3xl border border-ink-100 bg-surface p-6 shadow-soft transition hover:-translate-y-1 hover:shadow-lift"
				>
					<div class="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
						<f.icon size={22} />
					</div>
					<h3 class="mb-1 text-base font-bold text-ink-900">{translate($lang, f.title as 'stats')}</h3>
					<p class="text-sm text-ink-500">{translate($lang, f.desc as 'stats')}</p>
				</div>
			{/each}
		</div>
	</div>
{/if}
