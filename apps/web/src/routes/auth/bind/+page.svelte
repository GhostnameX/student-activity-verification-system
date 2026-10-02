<script lang="ts">
	import { lang } from '$lib/store';
	import { translate } from '$lib/i18n';
	import { bindStudentAccount, getBindSessionStatus } from '$lib/auth-client';
	import { loadSession, user } from '$lib/auth';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { ArrowLeft, Hash, LoaderCircle, Link2, Phone, ShieldCheck } from 'lucide-svelte';

	// The Google email and the bound student are never rendered here: the bind
	// cookie is HttpOnly and the status endpoint deliberately exposes nothing.
	type Phase = 'checking' | 'ready' | 'expired' | 'linked';

	let phase: Phase = $state('checking');
	let studentId: string = $state('');
	let phone: string = $state('');
	let submitting: boolean = $state(false);
	let errorMsg: string = $state('');

	const rolePath = { student: '/student', staff: '/stats', admin: '/admin' } as const;

	const errorKey: Record<string, 'bindErrorInvalidStudent' | 'bindErrorEmailMismatch' | 'bindErrorInvalidPhone' | 'bindErrorEmailBound' | 'bindErrorRateLimited' | 'bindErrorSessionInvalid'> = {
		invalid_student: 'bindErrorInvalidStudent',
		email_student_mismatch: 'bindErrorEmailMismatch',
		invalid_phone: 'bindErrorInvalidPhone',
		email_already_bound: 'bindErrorEmailBound',
		too_many_attempts: 'bindErrorRateLimited',
		bind_session_invalid: 'bindErrorSessionInvalid',
	};

	// Already signed in (e.g. re-opened the URL): nothing to bind.
	$effect(() => {
		const u = $user;
		if (u && phase !== 'linked') goto(rolePath[u.role as keyof typeof rolePath]);
	});

	onMount(async () => {
		const status = await getBindSessionStatus();
		phase = status.valid ? 'ready' : 'expired';
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (submitting) return;
		errorMsg = '';
		submitting = true;
		try {
			const { user: bound, error } = await bindStudentAccount(studentId.trim(), phone.trim());
			if (error || !bound) {
				const code = error ?? "bind_failed";
				// A dead bind session can never succeed, so stop showing the form.
				if (code === "bind_session_invalid" || code === "too_many_attempts") phase = 'expired';
				errorMsg = translate($lang, errorKey[code] ?? 'bindErrorGeneric').replace('{id}', studentId.trim() || ($lang === 'th' ? '<รหัส>' : '<ID>'));
				return;
			}
			phase = 'linked';
			await loadSession();
			await goto(rolePath.student);
		} catch {
			errorMsg = translate($lang, 'bindErrorGeneric');
		} finally {
			submitting = false;
		}
	}

	// text-base (16px) keeps iOS/iPadOS from zooming the viewport on focus.
	const inputClass =
		'w-full rounded-xl border border-ink-200 bg-ink-50 px-3.5 py-3 pl-11 text-base text-ink-900 placeholder-ink-400 transition focus:border-brand-500 focus:bg-surface focus:outline-none focus:ring-4 focus:ring-brand-100';
</script>

<div class="mx-auto flex min-h-[calc(100vh-8rem)] w-full max-w-md items-center py-8">
	<div class="relative w-full overflow-hidden rounded-3xl border border-ink-100 bg-surface shadow-lift">
		<div
			class="pointer-events-none absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-brand-500 via-brand-700 to-brand-900"
		></div>
		<div class="p-8 lg:p-10">
			{#if phase === 'checking'}
				<div class="flex flex-col items-center gap-4 py-10 text-center">
					<LoaderCircle size={32} class="animate-spin text-brand-600" />
					<p class="text-sm text-ink-500">{translate($lang, 'bindSessionChecking')}</p>
				</div>
			{:else if phase === 'expired'}
				<div class="py-4 text-center">
					<div
						class="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-rejected-soft text-rejected"
					>
						<ShieldCheck size={26} />
					</div>
					<h1 class="mb-2 text-2xl font-bold text-ink-900">{translate($lang, 'bindSessionInvalidTitle')}</h1>
					<p class="mb-7 text-sm leading-relaxed text-ink-500">
						{translate($lang, 'bindSessionInvalidBody')}
					</p>
					<a
						href="/auth/signin"
						class="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-solid py-3 font-semibold text-white shadow-soft transition hover:bg-brand-solid-hover"
					>
						<ArrowLeft size={17} />
						{translate($lang, 'bindBackToSignIn')}
					</a>
				</div>
			{:else}
				<div class="mb-6">
					<div
						class="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700"
					>
						<Link2 size={24} />
					</div>
					<h1 class="mb-1.5 text-2xl font-bold text-ink-900 lg:text-3xl">
						{translate($lang, 'bindTitle')}
					</h1>
					<p class="text-sm text-ink-500">{translate($lang, 'bindSubtitle')}</p>
					<p
						class="mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700"
					>
						<ShieldCheck size={14} />
						{translate($lang, 'bindGoogleVerified')}
					</p>
				</div>

				{#if errorMsg}
					<div class="mb-4 rounded-xl border border-rejected-ring bg-rejected-soft px-4 py-3 text-sm text-rejected">
						{errorMsg}
					</div>
				{/if}

				<form onsubmit={submit} class="space-y-5">
					<div>
						<label for="bindStudentId" class="mb-1.5 block text-sm font-medium text-ink-700">
							{translate($lang, 'bindStudentId')}
						</label>
						<div class="relative">
							<Hash
								size={17}
								class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400"
							/>
							<input
								id="bindStudentId"
								bind:value={studentId}
								name="studentId"
								type="text"
								required
								maxlength="64"
								autocomplete="off"
								autocapitalize="characters"
								spellcheck="false"
								placeholder="64-06-0-0000-00-0"
								class={inputClass}
							/>
						</div>
					</div>

					<div>
						<label for="bindPhone" class="mb-1.5 block text-sm font-medium text-ink-700">
							{translate($lang, 'bindPhone')}
						</label>
						<div class="relative">
							<Phone
								size={17}
								class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400"
							/>
							<input
								id="bindPhone"
								bind:value={phone}
								name="phone"
								type="tel"
								inputmode="tel"
								required
								maxlength="32"
								autocomplete="tel"
								placeholder="081-234-5678"
								class={inputClass}
							/>
						</div>
						<p class="mt-1.5 text-xs text-ink-400">{translate($lang, 'bindPhoneHint')}</p>
					</div>

					<button
						type="submit"
						disabled={submitting}
						class="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-solid py-3 font-semibold text-white shadow-soft transition hover:bg-brand-solid-hover disabled:opacity-50"
					>
						{#if submitting}
							<LoaderCircle size={17} class="animate-spin" />
						{:else}
							<Link2 size={17} />
						{/if}
						{submitting ? translate($lang, 'bindSubmitting') : translate($lang, 'bindSubmit')}
					</button>
				</form>
			{/if}
		</div>
	</div>
</div>
