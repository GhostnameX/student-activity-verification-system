<script lang="ts">
	import { onMount } from 'svelte';
	import { lang } from '$lib/store';
	import { user, loadSession } from '$lib/auth';
	import { translate } from '$lib/i18n';
	import { updateMe, uploadAvatar, removeAvatar, changePassword, avatarUrl } from '$lib/api';
	import { goto } from '$app/navigation';
	import { User, Phone, Save, CircleCheck, Camera, Trash2, KeyRound } from 'lucide-svelte';

	let phone: string = $state('');
	let name: string = $state('');
	let loading: boolean = $state(false);
	let successMsg: string = $state('');
	let errorMsg: string = $state('');

	let nameLoading: boolean = $state(false);
	let nameMsg: string = $state('');
	let nameErr: string = $state('');

	let avatarInput = $state<HTMLInputElement | null>(null);
	let avatarLoading: boolean = $state(false);
	let avatarMsg: string = $state('');
	let avatarErr: string = $state('');

	let pwCur = $state('');
	let pwNew = $state('');
	let pwConfirm = $state('');
	let pwLoading = $state(false);
	let pwMsg = $state('');
	let pwErr = $state('');

	const isStaff = $derived($user !== null && $user.role !== 'student');
	const initial = $derived(($user?.name ?? '?').trim().charAt(0).toUpperCase());

	onMount(async () => {
		await loadSession();
		if (!$user) {
			goto('/auth/signin');
			return;
		}
		phone = $user?.phone ?? '';
		name = $user.name;
	});

	async function saveProfile() {
		loading = true;
		successMsg = '';
		errorMsg = '';
		try {
			const res = await updateMe({ phone });
			user.set({ ...($user as NonNullable<typeof $user>), phone: res.phone ?? null });
			successMsg =
				res.phone === null ? translate($lang, 'phoneCleared') : translate($lang, 'phoneSaved');
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

	async function saveName() {
		const trimmed = name.trim();
		if (!trimmed) return;
		nameLoading = true;
		nameMsg = '';
		nameErr = '';
		try {
			const res = await updateMe({ name: trimmed });
			const next = { ...($user as NonNullable<typeof $user>), name: res.name ?? trimmed };
			user.set(next);
			name = next.name;
			nameMsg = translate($lang, 'nameSaved');
		} catch (e) {
			nameErr =
				e instanceof Error && e.message === 'student_name_locked'
					? translate($lang, 'studentNameLocked')
					: e instanceof Error
						? e.message
						: String(e);
		} finally {
			nameLoading = false;
		}
	}

	async function onAvatarPick(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		avatarLoading = true;
		avatarMsg = '';
		avatarErr = '';
		try {
			const res = await uploadAvatar(file);
			user.set({ ...($user as NonNullable<typeof $user>), avatarUrl: res.avatarUrl });
			avatarMsg = translate($lang, 'avatarUpdated');
		} catch (err) {
			avatarErr = err instanceof Error ? err.message : String(err);
		} finally {
			avatarLoading = false;
			input.value = '';
		}
	}

	async function onRemoveAvatar() {
		avatarLoading = true;
		avatarMsg = '';
		avatarErr = '';
		try {
			await removeAvatar();
			user.set({ ...($user as NonNullable<typeof $user>), avatarUrl: null });
			avatarMsg = translate($lang, 'avatarRemoved');
		} catch (err) {
			avatarErr = err instanceof Error ? err.message : String(err);
		} finally {
			avatarLoading = false;
		}
	}

	async function savePassword() {
		pwMsg = '';
		pwErr = '';
		if (pwNew !== pwConfirm) {
			pwErr = translate($lang, 'passwordMismatch');
			return;
		}
		if (pwNew.length < 8) {
			pwErr = translate($lang, 'passwordTooShort');
			return;
		}
		pwLoading = true;
		try {
			await changePassword({ currentPassword: pwCur, newPassword: pwNew });
			pwMsg = translate($lang, 'passwordChanged');
			pwCur = '';
			pwNew = '';
			pwConfirm = '';
		} catch (e) {
			pwErr =
				e instanceof Error && e.message === 'wrong_password'
					? translate($lang, 'wrongPassword')
					: e instanceof Error
						? e.message
						: String(e);
		} finally {
			pwLoading = false;
		}
	}

	const inputClass =
		'w-full rounded-xl border border-ink-200 bg-ink-50 px-3.5 py-2.5 text-sm text-ink-900 transition focus:border-brand-500 focus:bg-surface focus:outline-none focus:ring-4 focus:ring-brand-100';
	const phoneInputClass = inputClass.replace('px-3.5', 'pl-10 pr-3.5');
	const saveBtnClass =
		'flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white shadow-soft transition hover:bg-brand-700 disabled:opacity-50';
</script>

<div class="mx-auto max-w-lg py-4">
	<div class="mb-6">
		<h1 class="text-3xl font-extrabold tracking-tight text-ink-900">
			{translate($lang, 'profileTitle')}
		</h1>
		<p class="mt-1 text-sm text-ink-500">{translate($lang, 'tagline')}</p>
	</div>

	{#if $user}
		<div class="rounded-3xl border border-ink-100 bg-surface p-6 shadow-soft">
			<div class="flex flex-col gap-5">
				<div class="flex items-start gap-4">
					<div class="shrink-0">
						{#if $user.avatarUrl}
							<img
								src={avatarUrl($user.avatarUrl)}
								alt={translate($lang, 'avatar')}
								class="h-20 w-20 rounded-2xl border border-ink-100 object-cover"
							/>
						{:else}
							<span
								class="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-2xl font-bold text-white"
							>
								{initial}
							</span>
						{/if}
						<input
							bind:this={avatarInput}
							id="avatar-input"
							type="file"
							accept="image/png,image/jpeg,image/webp"
							class="hidden"
							onchange={onAvatarPick}
						/>
						<div class="mt-2 flex gap-1.5">
							<button
								onclick={() => avatarInput?.click()}
								disabled={avatarLoading}
								class="flex items-center gap-1 rounded-lg border border-ink-200 px-2 py-1.5 text-xs font-medium text-ink-700 transition hover:bg-ink-50 disabled:opacity-50"
							>
								<Camera size={13} />
								{translate($lang, 'changePhoto')}
							</button>
							{#if $user.avatarUrl}
								<button
									onclick={onRemoveAvatar}
									disabled={avatarLoading}
									class="flex items-center gap-1 rounded-lg border border-red-200 px-2 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
								>
									<Trash2 size={13} />
									{translate($lang, 'removePhoto')}
								</button>
							{/if}
						</div>
						{#if avatarMsg}
							<p class="mt-2 text-xs text-green-700">{avatarMsg}</p>
						{/if}
						{#if avatarErr}
							<p class="mt-2 text-xs text-red-600">{avatarErr}</p>
						{/if}
					</div>

					<div class="min-w-0 flex-1">
						{#if isStaff}
							<label for="profile-name" class="mb-1 block text-sm font-medium text-ink-700">
								{translate($lang, 'name')}
							</label>
							<div class="flex gap-2">
								<input
									id="profile-name"
									bind:value={name}
									type="text"
									maxlength={100}
									disabled={nameLoading}
									class={inputClass}
								/>
								<button
									onclick={saveName}
									disabled={nameLoading || !name.trim()}
									class={saveBtnClass}
								>
									{nameLoading ? translate($lang, 'submitting') : translate($lang, 'save')}
								</button>
							</div>
							{#if nameMsg}
								<p class="mt-1.5 text-xs text-green-700">{nameMsg}</p>
							{/if}
							{#if nameErr}
								<p class="mt-1.5 text-xs text-red-600">{nameErr}</p>
							{/if}
						{:else}
							<p class="truncate text-lg font-bold text-ink-900">{$user.name}</p>
							<p class="mt-0.5 text-xs text-ink-400">{translate($lang, 'studentNameLocked')}</p>
						{/if}

						<div class="mt-2 flex items-center gap-1.5">
							<span
								class="inline-flex rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700"
							>
								{translate($lang, $user.role === 'admin' ? 'admin' : isStaff ? 'staff' : 'student')}
							</span>
							{#if $user.kind}
								<span
									class={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
										$user.kind === 'emergency'
											? 'bg-amber-100 text-amber-700'
											: 'bg-ink-100 text-ink-700'
									}`}
								>
									{translate($lang, $user.kind === 'emergency' ? 'emergency' : 'mainAccount')}
								</span>
							{/if}
							{#if $user.faculty}
								<span class="inline-flex rounded-full bg-ink-50 px-3 py-1 text-xs font-medium text-ink-500">
									{$user.faculty}
								</span>
							{/if}
						</div>
						<p class="mt-1.5 truncate text-sm text-ink-500">{$user.email}</p>
					</div>
				</div>

				{#if !isStaff && $user.studentId}
					<div class="grid grid-cols-1 gap-2 rounded-2xl bg-ink-50/60 px-4 py-3 text-sm sm:grid-cols-3">
						<div>
							<span class="text-ink-400">{translate($lang, 'studentId')}: </span>
							<span class="font-medium text-ink-800">{$user.studentId}</span>
						</div>
						<div>
							<span class="text-ink-400">{translate($lang, 'level')}: </span>
							<span class="font-medium text-ink-800">{$user.admissionYear ?? '-'}</span>
						</div>
					</div>
				{/if}
			</div>
		</div>

		{#if !isStaff}
			<div class="mt-5 rounded-3xl border border-ink-100 bg-surface p-6 shadow-soft">
				<div class="mb-4 flex items-center gap-2 border-b border-ink-100 pb-4">
					<User size={18} class="text-brand-600" />
					<h2 class="font-bold text-ink-900">{translate($lang, 'profileTitle')}</h2>
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
				<form onsubmit={saveProfile} class="space-y-4">
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
								class={phoneInputClass}
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
		{/if}

		{#if isStaff}
			<div class="mt-5 rounded-3xl border border-ink-100 bg-surface p-6 shadow-soft">
				<div class="mb-4 flex items-center gap-2 border-b border-ink-100 pb-4">
					<KeyRound size={18} class="text-brand-600" />
					<h2 class="font-bold text-ink-900">{translate($lang, 'changePassword')}</h2>
				</div>
				{#if pwMsg}
					<div class="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
						{pwMsg}
					</div>
				{/if}
				{#if pwErr}
					<div class="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
						{pwErr}
					</div>
				{/if}
				<div class="space-y-4">
					<div>
						<label for="pw-current" class="mb-1.5 block text-sm font-medium text-ink-700">
							{translate($lang, 'currentPassword')}
						</label>
						<input
							id="pw-current"
							bind:value={pwCur}
							type="password"
							autocomplete="current-password"
							class={inputClass}
						/>
					</div>
					<div>
						<label for="pw-new" class="mb-1.5 block text-sm font-medium text-ink-700">
							{translate($lang, 'newPassword')}
						</label>
						<input
							id="pw-new"
							bind:value={pwNew}
							type="password"
							autocomplete="new-password"
							class={inputClass}
						/>
					</div>
					<div>
						<label for="pw-confirm" class="mb-1.5 block text-sm font-medium text-ink-700">
							{translate($lang, 'confirmPassword')}
						</label>
						<input
							id="pw-confirm"
							bind:value={pwConfirm}
							type="password"
							autocomplete="new-password"
							class={inputClass}
						/>
					</div>
					<button
						onclick={savePassword}
						disabled={pwLoading || !pwCur || !pwNew || !pwConfirm}
						class="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-2.5 font-medium text-white shadow-soft transition hover:bg-brand-700 disabled:opacity-50"
					>
						<KeyRound size={16} />
						{pwLoading ? translate($lang, 'submitting') : translate($lang, 'confirm')}
					</button>
				</div>
			</div>
		{/if}
	{:else}
		<div class="rounded-2xl border border-dashed border-ink-200 bg-surface/60 px-6 py-10 text-center">
			<CircleCheck size={28} class="mx-auto mb-2 text-ink-300" />
			<p class="text-sm text-ink-500">{translate($lang, 'mustLogin')}</p>
		</div>
	{/if}
</div>