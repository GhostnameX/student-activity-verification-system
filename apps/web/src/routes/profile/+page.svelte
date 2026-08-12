<script lang="ts">
	import { onMount } from 'svelte';
	import { lang } from '$lib/store';
	import { user } from '$lib/auth';
	import { translate } from '$lib/i18n';
	import { updateMe } from '$lib/api';
	import { goto } from '$app/navigation';
	import { User, Phone, Save, CircleCheck } from 'lucide-svelte';

	let phone: string = $state('');
	let loading: boolean = $state(false);
	let successMsg: string = $state('');
	let errorMsg: string = $state('');

	onMount(() => {
		if (!$user) {
			goto('/auth/signin');
			return;
		}
		phone = $user?.phone ?? '';
	});

	async function save() {
		loading = true;
		successMsg = '';
		errorMsg = '';
		try {
			const res = await updateMe({ phone });
			user.set({ ...($user as NonNullable<typeof $user>), phone: res.phone });
			successMsg = res.phone === null ? translate($lang, 'phoneCleared') : translate($lang, 'phoneSaved');
		} catch (e) {
			errorMsg =
				e instanceof Error && e.message === 'invalid_phone'
					? translate($lang, 'invalidPhone')
					: e instanceof Error
						? e.message
						: String(e);
		} finally {
			loading = false;
		}
	}

	const inputClass =
		'w-full rounded-xl border border-ink-200 bg-ink-50 px-3.5 py-2.5 text-sm text-ink-900 transition focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-100';
</script>

<div class="mx-auto max-w-lg py-4">
	<div class="mb-6">
		<h1 class="text-3xl font-extrabold tracking-tight text-ink-900">
			{translate($lang, 'profileTitle')}
		</h1>
		<p class="mt-1 text-sm text-ink-500">{translate($lang, 'tagline')}</p>
	</div>

	{#if $user}
		<div class="rounded-3xl border border-ink-100 bg-white p-6 shadow-soft">
			<div class="mb-6 flex items-center gap-3.5 border-b border-ink-100 pb-5">
				<span class="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
					<User size={24} />
				</span>
				<div class="min-w-0">
					<p class="truncate font-bold text-ink-900">{$user.name}</p>
					<p class="text-sm text-ink-500">{$user.email}</p>
				</div>
			</div>

			{#if errorMsg}
				<div class="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
					{errorMsg}
				</div>
			{/if}
			{#if successMsg}
				<div class="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
					{successMsg}
				</div>
			{/if}

			<form onsubmit={save} class="space-y-4">
				<div>
					<label for="phone" class="mb-1.5 block text-sm font-medium text-ink-700">
						{translate($lang, 'phone')}
					</label>
					<div class="relative">
						<Phone
							size={17}
							class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400"
						/>
						<input
							id="phone"
							bind:value={phone}
							type="tel"
							inputmode="tel"
							placeholder={translate($lang, 'phonePlaceholder')}
							class={inputClass}
						/>
					</div>
					<p class="mt-1.5 text-xs text-ink-400">{translate($lang, 'phoneOnCertificate')}</p>
				</div>
				<button
					type="submit"
					disabled={loading}
					class="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-2.5 font-medium text-white shadow-soft transition hover:bg-brand-700 disabled:opacity-50"
				>
					<Save size={17} />
					{loading ? translate($lang, 'submitting') : translate($lang, 'save')}
				</button>
			</form>
		</div>
	{:else}
		<div class="rounded-2xl border border-dashed border-ink-200 bg-white/60 px-6 py-10 text-center">
			<CircleCheck size={28} class="mx-auto mb-2 text-ink-300" />
			<p class="text-sm text-ink-500">{translate($lang, 'mustLogin')}</p>
		</div>
	{/if}
</div>
