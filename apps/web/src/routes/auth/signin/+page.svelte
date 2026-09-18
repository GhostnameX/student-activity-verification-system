<script lang="ts">
	import { lang } from '$lib/store';
	import { translate } from '$lib/i18n';
	import { signInWithPassword, getGoogleSignInUrl } from '$lib/auth-client';
	import { loadSession } from '$lib/auth';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { LogIn, Mail, Lock, GraduationCap, ShieldCheck, FileText } from 'lucide-svelte';

	let email: string = $state('');
	let password: string = $state('');
	let loading: boolean = $state(false);
	let errorMsg: string = $state('');

	onMount(() => {
		const q = new URLSearchParams(window.location.search);
		const err = q.get('error');
		if (err) {
			if (err === 'not_in_roster') errorMsg = translate($lang, 'notInRoster');
			else errorMsg = translate($lang, 'googleAuthFailed');
		}
	});

	async function signInStaff() {
		loading = true;
		errorMsg = '';
		const { user: u, error } = await signInWithPassword(email, password);
		loading = false;
		if (error || !u) {
			errorMsg = translate($lang, 'invalidCredentials');
			return;
		}
		await loadSession();
		goto('/');
	}

	async function signInGoogle() {
		loading = true;
		errorMsg = '';
		try {
			const url = await getGoogleSignInUrl(window.location.pathname);
			window.location.href = url;
		} catch {
			loading = false;
			errorMsg = translate($lang, 'googleAuthFailed');
		}
	}

	const inputClass =
		'w-full rounded-xl border border-ink-200 bg-ink-50 px-3.5 py-3 pl-11 text-sm text-ink-900 placeholder-ink-400 transition focus:border-brand-500 focus:bg-surface focus:outline-none focus:ring-4 focus:ring-brand-100';
</script>

<div class="mx-auto grid min-h-[calc(100vh-8rem)] max-w-6xl grid-cols-1 items-center gap-10 py-8 lg:grid-cols-2 lg:gap-16">
	<div class="hidden lg:block">
		<div
			class="relative overflow-hidden rounded-[2.5rem] bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 p-10 text-white shadow-lift"
		>
			<div class="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-surface/10 blur-2xl"></div>
			<div class="pointer-events-none absolute -bottom-32 -left-20 h-80 w-80 rounded-full bg-brand-400/20 blur-3xl"></div>
			<div class="relative">
				<div class="mb-8 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface/15 backdrop-blur">
					<GraduationCap size={34} />
				</div>
				<h1 class="mb-3 text-4xl font-extrabold leading-tight">{translate($lang, 'appName')}</h1>
				<p class="mb-10 text-lg text-brand-100">{translate($lang, 'tagline')}</p>

				<div class="space-y-4">
					<div class="flex items-start gap-3 rounded-2xl bg-surface/10 p-4 backdrop-blur">
						<ShieldCheck size={20} class="mt-0.5 shrink-0 text-brand-200" />
						<div>
							<p class="font-semibold">{translate($lang, 'myRequests')}</p>
							<p class="text-sm text-brand-100">{translate($lang, 'submittedAt')}</p>
						</div>
					</div>
					<div class="flex items-start gap-3 rounded-2xl bg-surface/10 p-4 backdrop-blur">
						<FileText size={20} class="mt-0.5 shrink-0 text-brand-200" />
						<div>
							<p class="font-semibold">{translate($lang, 'allRequests')}</p>
							<p class="text-sm text-brand-100">{translate($lang, 'status')}</p>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>

	<div class="mx-auto w-full max-w-md">
		<div class="relative overflow-hidden rounded-3xl border border-ink-100 bg-surface shadow-lift">
			<div
				class="pointer-events-none absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-brand-500 via-brand-700 to-brand-900"
			></div>
			<div class="p-8 lg:p-10">
				<h1 class="mb-1 text-2xl font-bold text-ink-900 lg:text-3xl">
					{translate($lang, 'login')}
				</h1>
				<p class="mb-6 text-sm text-ink-500">{translate($lang, 'tagline')}</p>

				{#if errorMsg}
					<div class="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
						{errorMsg}
					</div>
				{/if}

				<button
					type="button"
					onclick={signInGoogle}
					disabled={loading}
					class="flex w-full items-center justify-center gap-3 rounded-xl border border-ink-200 bg-surface py-3 font-semibold text-ink-800 shadow-soft transition hover:bg-ink-50 disabled:opacity-50"
				>
					<svg width="18" height="18" viewBox="0 0 24 24">
						<path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/>
						<path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
						<path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A11 11 0 0 0 1 12c0 1.77.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
						<path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
					</svg>
					{translate($lang, 'googleSignIn')}
				</button>

				<div class="my-6 flex items-center gap-3 text-xs text-ink-400">
					<div class="h-px flex-1 bg-ink-100"></div>
					{translate($lang, 'student')}
					<div class="h-px flex-1 bg-ink-100"></div>
				</div>

				<form onsubmit={signInStaff} class="space-y-5">
					<div>
						<label for="email" class="mb-1.5 block text-sm font-medium text-ink-700">
							{translate($lang, 'email')}
						</label>
						<div class="relative">
							<Mail
								size={17}
								class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400"
							/>
							<input
								id="email"
								bind:value={email}
								type="email"
								required
								autocomplete="email"
								placeholder="staff@uni.ac.th"
								class={inputClass}
							/>
						</div>
					</div>
					<div>
						<label for="password" class="mb-1.5 block text-sm font-medium text-ink-700">
							{translate($lang, 'password')}
						</label>
						<div class="relative">
							<Lock
								size={17}
								class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400"
							/>
							<input
								id="password"
								bind:value={password}
								type="password"
								required
								autocomplete="current-password"
								placeholder="••••••••"
								class={inputClass}
							/>
						</div>
					</div>
					<button
						type="submit"
						disabled={loading}
						class="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-3 font-semibold text-white shadow-soft transition hover:bg-brand-700 disabled:opacity-50"
					>
						<LogIn size={17} />
						{loading ? translate($lang, 'submitting') : translate($lang, 'staffLogin')}
					</button>
				</form>
			</div>
		</div>
	</div>
</div>