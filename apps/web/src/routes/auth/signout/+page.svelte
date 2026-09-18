<script lang="ts">
	import { onMount } from 'svelte';
	import { signOut } from '$lib/auth-client';
	import { user } from '$lib/auth';
	import { goto } from '$app/navigation';

	onMount(async () => {
		await signOut();
		user.set(null);
		goto('/auth/signin');
	});
</script>
