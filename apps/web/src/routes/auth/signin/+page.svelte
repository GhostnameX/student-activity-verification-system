<script lang="ts">
	import { lang } from '$lib/store';
	import { translate } from '$lib/i18n';
	import { authClient } from '$lib/auth-client';
	import { loadSession } from '$lib/auth';
	import { goto } from '$app/navigation';
	import { LogIn, Mail, Lock, GraduationCap, ShieldCheck, FileText, UserPlus, User } from 'lucide-svelte';

	const DUR = 700;
	const reduced =
		typeof window !== 'undefined' &&
		window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	let mode: 'signin' | 'signup' = $state('signin');
	let blade = $state(-100);
	let animating: boolean = $state(false);

	if (typeof window !== 'undefined') {
		const m = new URLSearchParams(window.location.search).get('mode');
		if (m === 'signup') {
			mode = 'signup';
			blade = 100;
		}
	}

	function toggleMode() {
		if (animating) return;
		animating = true;
		const target = mode === 'signin' ? 'signup' : 'signin';
		blade = -blade;
		if (reduced) {
			mode = target;
			animating = false;
			return;
		}
		setTimeout(() => {
			mode = target;
		}, DUR / 2);
		setTimeout(() => {
			animating = false;
		}, DUR + 50);
	}

	async function signIn() {
		loading = true;
		errorMsg = '';
		const { error } = await authClient.signIn.email({ email, password });
		loading = false;
		if (error) {
			errorMsg = translate($lang, 'invalidCredentials');
			return;
		}
		await loadSession();
		goto('/');
	}

	async function signUp() {
		signupLoading = true;
		signupError = '';
		const { error } = await authClient.signUp.email({
			name,
			email: signupEmail,
			password: signupPassword,
		});
		signupLoading = false;
		if (error) {
			signupError = translate($lang, 'error') + ': ' + error.message;
			return;
		}
		await loadSession();
		goto('/');
	}

	let email: string = $state('');
	let password: string = $state('');
	let loading: boolean = $state(false);
	let errorMsg: string = $state('');

	let name: string = $state('');
	let signupEmail: string = $state('');
	let signupPassword: string = $state('');
	let signupLoading: boolean = $state(false);
	let signupError: string = $state('');

	const inputClass =
		'w-full rounded-xl border border-ink-200 bg-ink-50 px-3.5 py-3 pl-11 text-sm text-ink-900 placeholder-ink-400 transition focus:border-brand-500 focus:bg-surface focus:outline-none focus:ring-4 focus:ring-brand-100';
	const toggleLink =
		'cursor-pointer font-medium text-brand-600 transition hover:text-brand-700 hover:underline disabled:cursor-not-allowed disabled:opacity-50';
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
		<div
			class="relative overflow-hidden rounded-3xl border border-ink-100 bg-surface shadow-lift"
		>
			<div
				class="pointer-events-none absolute inset-0 z-20 flex items-center justify-center overflow-hidden"
				style="transform: translateX({blade}%); transition: transform {reduced ? 0 : DUR}ms cubic-bezier(0.65, 0, 0.35, 1)"
			>
				<div class="absolute inset-0 bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900">
					<div class="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-surface/10 blur-2xl"></div>
					<div class="pointer-events-none absolute -bottom-24 -left-16 h-64 w-64 rounded-full bg-brand-400/20 blur-3xl"></div>
				</div>
				<div class="relative mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-surface/15 backdrop-blur">
					<GraduationCap size={30} class="text-white" />
				</div>
			</div>

			<div class="grid">
				<div
					class="col-start-1 row-start-1 p-8 lg:p-10 transition-opacity duration-150"
					class:opacity-100={mode === 'signin'}
					class:opacity-0={mode !== 'signin'}
					class:pointer-events-none={mode !== 'signin'}
					aria-hidden={mode !== 'signin'}
				>
					<h1 class="mb-1 text-2xl font-bold text-ink-900 lg:text-3xl">
						{translate($lang, 'login')}
					</h1>
					<p class="mb-6 text-sm text-ink-500">{translate($lang, 'tagline')}</p>

					{#if errorMsg}
						<div class="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
							{errorMsg}
						</div>
					{/if}

					<form onsubmit={signIn} class="space-y-5">
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
									placeholder="student@uni.ac.th"
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
							{loading ? translate($lang, 'submitting') : translate($lang, 'signIn')}
						</button>
					</form>

					<p class="mt-6 text-center text-sm text-ink-500">
						{translate($lang, 'noAccount')}
						<button type="button" onclick={toggleMode} disabled={animating} class={toggleLink}>
							{translate($lang, 'signUp')}
						</button>
					</p>
				</div>

				<div
					class="col-start-1 row-start-1 p-8 lg:p-10 transition-opacity duration-150"
					class:opacity-100={mode === 'signup'}
					class:opacity-0={mode !== 'signup'}
					class:pointer-events-none={mode !== 'signup'}
					aria-hidden={mode !== 'signup'}
				>
					<h1 class="mb-1 text-2xl font-bold text-ink-900 lg:text-3xl">
						{translate($lang, 'signUp')}
					</h1>
					<p class="mb-6 text-sm text-ink-500">{translate($lang, 'tagline')}</p>

					{#if signupError}
						<div class="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
							{signupError}
						</div>
					{/if}

					<form onsubmit={signUp} class="space-y-4">
						<div>
							<label for="name" class="mb-1.5 block text-sm font-medium text-ink-700">
								{translate($lang, 'name')}
							</label>
							<div class="relative">
								<User
									size={17}
									class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400"
								/>
								<input
									id="name"
									bind:value={name}
									type="text"
									required
									autocomplete="name"
									placeholder={translate($lang, 'nameLabel')}
									class={inputClass}
								/>
							</div>
						</div>
						<div>
							<label for="signup-email" class="mb-1.5 block text-sm font-medium text-ink-700">
								{translate($lang, 'email')}
							</label>
							<div class="relative">
								<Mail
									size={17}
									class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400"
								/>
								<input
									id="signup-email"
									bind:value={signupEmail}
									type="email"
									required
									autocomplete="email"
									placeholder="student@uni.ac.th"
									class={inputClass}
								/>
							</div>
						</div>
						<div>
							<label for="signup-password" class="mb-1.5 block text-sm font-medium text-ink-700">
								{translate($lang, 'password')}
							</label>
							<div class="relative">
								<Lock
									size={17}
									class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400"
								/>
								<input
									id="signup-password"
									bind:value={signupPassword}
									type="password"
									required
									minlength="8"
									autocomplete="new-password"
									placeholder="••••••••"
									class={inputClass}
								/>
							</div>
						</div>
						<button
							type="submit"
							disabled={signupLoading}
							class="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-3 font-semibold text-white shadow-soft transition hover:bg-brand-700 disabled:opacity-50"
						>
							<UserPlus size={17} />
							{signupLoading ? translate($lang, 'submitting') : translate($lang, 'signUp')}
						</button>
					</form>

					<p class="mt-6 text-center text-sm text-ink-500">
						{translate($lang, 'hasAccount')}
						<button type="button" onclick={toggleMode} disabled={animating} class={toggleLink}>
							{translate($lang, 'signIn')}
						</button>
					</p>
				</div>
			</div>
		</div>
	</div>
</div>
