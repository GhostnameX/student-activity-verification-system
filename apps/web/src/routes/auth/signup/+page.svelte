<script lang="ts">
	import { lang } from '$lib/store';
	import { translate } from '$lib/i18n';
	import { authClient } from '$lib/auth-client';
	import { loadSession } from '$lib/auth';
	import { goto } from '$app/navigation';
	import { UserPlus, Mail, Lock, User } from 'lucide-svelte';

	let name: string = $state('');
	let email: string = $state('');
	let password: string = $state('');
	let loading: boolean = $state(false);
	let errorMsg: string = $state('');

	async function signUp() {
		loading = true;
		errorMsg = '';
		const { data, error } = await authClient.signUp.email({
			name,
			email,
			password,
		});
		loading = false;
		if (error) {
			errorMsg = translate($lang, 'error') + ': ' + error.message;
			return;
		}
		await loadSession();
		goto('/');
	}

	const inputClass =
		'w-full rounded-xl border border-ink-200 bg-ink-50 px-3.5 py-2.5 pl-10 text-sm text-ink-900 placeholder-ink-400 transition focus:border-brand-500 focus:bg-surface focus:outline-none focus:ring-4 focus:ring-brand-100';
</script>

<div class="mx-auto max-w-md py-10">
	<div class="overflow-hidden rounded-3xl border border-ink-100 bg-surface shadow-lift">
		<div class="bg-gradient-to-br from-brand-600 to-brand-800 px-8 py-7 text-center">
			<div
				class="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface/15 text-3xl backdrop-blur"
			>
				๐“
			</div>
			<h1 class="text-2xl font-bold text-white">{translate($lang, 'signUp')}</h1>
			<p class="mt-1 text-sm text-brand-100">{translate($lang, 'tagline')}</p>
		</div>

		<div class="p-8">
			{#if errorMsg}
				<div class="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
					{errorMsg}
				</div>
			{/if}

			<form onsubmit={signUp} class="space-y-4">
				<div>
					<label for="name" class="mb-1.5 block text-sm font-medium text-ink-700">
						{translate($lang, 'name')}
					</label>
					<div class="relative">
						<User
							size={16}
							class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400"
						/>
						<input
							id="name"
							bind:value={name}
							type="text"
							required
							placeholder={translate($lang, 'nameLabel')}
							class={inputClass}
						/>
					</div>
				</div>
				<div>
					<label for="email" class="mb-1.5 block text-sm font-medium text-ink-700">
						{translate($lang, 'email')}
					</label>
					<div class="relative">
						<Mail
							size={16}
							class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400"
						/>
						<input
							id="email"
							bind:value={email}
							type="email"
							required
							placeholder="you@uni.ac.th"
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
							size={16}
							class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400"
						/>
						<input
							id="password"
							bind:value={password}
							type="password"
							required
							minlength="8"
							placeholder="โ€ขโ€ขโ€ขโ€ขโ€ขโ€ขโ€ขโ€ข"
							class={inputClass}
						/>
					</div>
				</div>
				<button
					type="submit"
					disabled={loading}
					class="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-2.5 font-medium text-white shadow-soft transition hover:bg-brand-700 disabled:opacity-50"
				>
					<UserPlus size={17} />
					{loading ? translate($lang, 'submitting') : translate($lang, 'signUp')}
				</button>
			</form>

			<p class="mt-6 text-center text-sm text-ink-500">
				{translate($lang, 'hasAccount')}
				<a
					href="/auth/signin"
					class="font-medium text-brand-600 hover:text-brand-700 hover:underline"
				>
					{translate($lang, 'signIn')}
				</a>
			</p>
		</div>
	</div>
</div>
