<script lang="ts">
	import { X } from 'lucide-svelte';

	let {
		title,
		description = '',
		show = true,
		onclose,
	}: {
		title: string;
		description?: string;
		show?: boolean;
		onclose: () => void;
	} = $props();
</script>

{#if show}
	<div class="success-overlay" role="presentation">
		<button
			class="success-backdrop"
			type="button"
			aria-label={title}
			onclick={onclose}
		></button>
		<div class="success-card">
			<div class="success-badge">
				<svg viewBox="0 0 52 52" class="success-svg">
					<circle class="badge-ring" cx="26" cy="26" r="24" fill="none" />
					<path class="badge-check" d="M15 27 l8 8 l15 -16" fill="none" />
				</svg>
				<span class="ripple r1"></span>
				<span class="ripple r2"></span>
			</div>
			<h2 class="success-title" role="status" aria-live="polite">{title}</h2>
			{#if description}
				<p class="success-desc">{description}</p>
			{/if}
			<button class="success-close" type="button" onclick={onclose}>
				<X size={16} />
			</button>
		</div>
	</div>
{/if}

<style>
	.success-overlay {
		position: fixed;
		inset: 0;
		z-index: 70;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.25rem;
		background: rgb(28 30 44 / 0.45);
		backdrop-filter: blur(4px);
		animation: overlay-in 0.25s ease-out;
	}

	.success-backdrop {
		position: absolute;
		inset: 0;
		z-index: 0;
		border: 0;
		padding: 0;
		background: transparent;
		cursor: default;
	}

	.success-card {
		position: relative;
		z-index: 1;
		width: 100%;
		max-width: 24rem;
		padding: 2.75rem 2rem 2rem;
		border-radius: 1.75rem;
		background: var(--color-surface);
		box-shadow: var(--shadow-lift);
		text-align: center;
		animation: card-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
	}

	.success-badge {
		position: relative;
		width: 6.5rem;
		height: 6.5rem;
		margin: 0 auto 1.25rem;
	}

	.success-svg {
		position: relative;
		z-index: 2;
		width: 100%;
		height: 100%;
		overflow: visible;
	}

	.badge-ring {
		stroke: var(--color-brand-600);
		stroke-width: 3;
		stroke-linecap: round;
		stroke-dasharray: 151;
		stroke-dashoffset: 151;
		animation: ring-draw 0.45s cubic-bezier(0.65, 0, 0.35, 1) 0.05s forwards;
	}

	.badge-check {
		stroke: var(--color-brand-600);
		stroke-width: 5;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-dasharray: 52;
		stroke-dashoffset: 52;
		animation: check-draw 0.35s cubic-bezier(0.65, 0, 0.35, 1) 0.35s forwards;
	}

	.ripple {
		position: absolute;
		inset: 0;
		border-radius: 9999px;
		background: var(--color-brand-500);
		opacity: 0;
		z-index: 1;
	}

	.r1 {
		animation: ripple-out 1s cubic-bezier(0.22, 1, 0.36, 1) 0.25s forwards;
	}

	.r2 {
		animation: ripple-out 1s cubic-bezier(0.22, 1, 0.36, 1) 0.45s forwards;
	}

	.success-title {
		margin: 0;
		font-size: 1.375rem;
		font-weight: 800;
		letter-spacing: -0.01em;
		color: var(--color-ink-900);
		animation: text-in 0.4s ease-out 0.35s both;
	}

	.success-desc {
		margin: 0.375rem auto 0;
		max-width: 18rem;
		font-size: 0.875rem;
		line-height: 1.5;
		color: var(--color-ink-500);
		animation: text-in 0.4s ease-out 0.45s both;
	}

	.success-close {
		position: absolute;
		top: 0.875rem;
		right: 0.875rem;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border-radius: 0.75rem;
		color: var(--color-ink-400);
		cursor: pointer;
		transition: background 0.15s ease, color 0.15s ease;
	}

	.success-close:hover {
		background: var(--color-ink-50);
		color: var(--color-ink-700);
	}

	@keyframes overlay-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes card-pop {
		from {
			opacity: 0;
			transform: scale(0.85) translateY(16px);
		}
		to {
			opacity: 1;
			transform: scale(1) translateY(0);
		}
	}

	@keyframes ring-draw {
		to {
			stroke-dashoffset: 0;
		}
	}

	@keyframes check-draw {
		to {
			stroke-dashoffset: 0;
		}
	}

	@keyframes ripple-out {
		from {
			opacity: 0.35;
			transform: scale(1);
		}
		to {
			opacity: 0;
			transform: scale(1.8);
		}
	}

	@keyframes text-in {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
