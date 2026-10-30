<script lang="ts">
  import { onMount } from 'svelte';
  import { auth } from '../auth/google';
  import { drive } from '../drive/client';
  import { getAccount, type Account } from '../drive/account';
  import { clearFolderCache } from '../drive/notes';
  import { safeLocalStorage } from '../store/storage';
  import SessionBanner from './SessionBanner.svelte';
  import SignIn from './SignIn.svelte';
  import Workspace from './Workspace.svelte';

  let account = $state<Account | null>(null);
  let workspace = $state<Workspace>();

  /** Renew a token that is expired or about to expire when the user comes back. */
  const RENEW_WITHIN_MS = 5 * 60_000;

  onMount(() => {
    auth.init();
    const onReturn = () => {
      if (document.visibilityState === 'visible') auth.renewIfExpiring(RENEW_WITHIN_MS);
    };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    };
  });

  // Load the account whenever a sign-in completes, however it completed.
  let loadingAccount = false;
  $effect(() => {
    if ($auth.status === 'signed-in' && !account && !loadingAccount) void loadAccount();
  });

  async function loadAccount() {
    loadingAccount = true;
    try {
      account = await getAccount(drive);
      auth.rememberAccount(account.emailAddress);
    } catch {
      // Only used to show the email and as a login hint.
    } finally {
      loadingAccount = false;
    }
  }

  function handleSignIn(options?: { selectAccount?: boolean }) {
    auth.signIn(options);
  }

  async function handleSignOut() {
    // While the session is expired a save would wait for a token that can't come.
    const saved =
      auth.state.status === 'signed-in'
        ? ((await workspace?.flush()) ?? true)
        : !workspace?.hasUnsavedWork();
    if (
      !saved &&
      !confirm("Some changes couldn't be saved to Drive and will be lost. Sign out anyway?")
    ) {
      return;
    }
    auth.signOut();
    clearFolderCache(safeLocalStorage());
    account = null;
  }
</script>

{#if $auth.status === 'loading' || $auth.status === 'signed-out'}
  <SignIn onSignIn={handleSignIn} />
{:else}
  <div class="shell">
    <SessionBanner />
    <Workspace
      bind:this={workspace}
      {account}
      onSignOut={handleSignOut}
      onExpireToken={import.meta.env.DEV ? () => auth.invalidate() : undefined}
    />
  </div>
{/if}

<style>
  .shell {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
</style>
