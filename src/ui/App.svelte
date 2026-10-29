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

  const devLabel = import.meta.env.DEV ? ' (dev)' : '';

  let account = $state<Account | null>(null);
  let workspace = $state<Workspace>();

  onMount(() => {
    void auth.init();
  });

  async function handleSignIn(options?: { selectAccount?: boolean }) {
    if (!(await auth.signIn(options))) return;
    try {
      account = await getAccount(drive);
      auth.rememberAccount(account.emailAddress);
    } catch {
      // Only used to show the email and as a login hint.
    }
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
    <header>
      <h1>notes.md{devLabel}</h1>
      <div class="account">
        {#if account}<span class="email">{account.emailAddress}</span>{/if}
        {#if import.meta.env.DEV}
          <button class="secondary" onclick={() => auth.invalidate()} title="Drop the access token">
            Expire token
          </button>
        {/if}
        <button class="secondary" onclick={handleSignOut}>Sign out</button>
      </div>
    </header>
    <Workspace bind:this={workspace} />
  </div>
{/if}

<style>
  .shell {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 56px;
    padding: 0 16px;
    border-bottom: 1px solid var(--border);
  }

  h1 {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 600;
    white-space: nowrap;
  }

  .account {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .email {
    overflow: hidden;
    color: var(--text-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (max-width: 599px) {
    .email {
      display: none;
    }
  }

  .secondary {
    min-height: 44px;
    padding: 0 16px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-muted);
    color: var(--text);
    font: inherit;
    cursor: pointer;
    white-space: nowrap;
  }
</style>
