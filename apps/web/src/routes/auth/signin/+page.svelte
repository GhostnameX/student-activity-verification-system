<script lang="ts">
	import { lang } from '$lib/store';
	import { translate } from '$lib/i18n';
	import { authClient } from '$lib/auth-client';
	import { user, loadSession } from '$lib/auth';
	import { goto } from '$app/navigation';
	import { LogIn, Mail, Lock, GraduationCap, ShieldCheck, FileText } from 'lucide-svelte';

	let email: string = $state('');
	let password: string = $state('');
	let loading: boolean = $state(false);
	let errorMsg: string = $state('');

	async function signIn() {
		loading = true;
		errorMsg = '';
		const { data, error } = await authClient.signIn.email({
			email,
			password,
		});
		loading = false;
		if (error) {
			errorMsg = translate($lang, 'invalidCredentials');
			return;
		}
		await loadSession();
		goto('/');
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
		<div class="overflow-hidden rounded-3xl border border-ink-100 bg-surface shadow-lift">
			<div class="bg-gradient-to-br from-brand-600 to-brand-800 px-8 py-7 text-center lg:hidden">
				<div class="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface/15 text-3xl backdrop-blur">
					🎓
				</div>
				<h1 class="text-2xl font-bold text-white">{translate($lang, 'login')}</h1>
				<p class="mt-1 text-sm text-brand-100">{translate($lang, 'tagline')}</p>
			</div>

			<div class="p-8 lg:p-10">
				<h1 class="mb-1 text-2xl font-bold text-ink-900 lg:text-3xl">{translate($lang, 'login')}</h1>
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
								placeholder="กรอกรหัสผ่าน"
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
					<a
						href="/auth/signup"
						class="font-medium text-brand-600 hover:text-brand-700 hover:underline"
					>
						{translate($lang, 'signUp')}
					</a>
				</p>
			</div>
		</div>
	</div>
</div>
