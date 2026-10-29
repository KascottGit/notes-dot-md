<script lang="ts">
  import { onMount } from 'svelte';
  import { auth } from '../auth/google';
  import { drive } from '../drive/client';
  import { getAccount, type Account } from '../drive/account';
  import { clearFolderCache } from '../drive/notes';
  import { safeLocalStorage } from '../store/storage';
  import DriveTestPanel from './DriveTestPanel.svelte';
  import SessionBanner from './SessionBanner.svelte';
  import SignIn from './SignIn.svelte';

  const devLabel = import.meta.env.DEV ? ' (dev)' : '';

  let account = $state<Account | null>(null);
  let checkResult = $state('');
  let checking = $state(false);

  onMount(() => {
    void auth.init();
  });

  async function handleSignIn(options?: { selectAccount?: boolean }) {
    if (!(await auth.signIn(options))) return;
    await checkConnection();
  }

  function handleSignOut() {
    auth.signOut();
    clearFolderCache(safeLocalStorage());
    account = null;
    checkResult = '';
  }

  /** Calls Drive with the current token. Used to verify sign-in and token renewal. */
  async function checkConnection() {
    checking = true;
    try {
      account = await getAccount(drive);
      auth.rememberAccount(account.emailAddress);
      checkResult = `Drive connection OK at ${new Date().toLocaleTimeString()}`;
    } catch (err) {
      checkResult = `Drive request failed: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      checking = false;
    }
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
        <button class="secondary" onclick={handleSignOut}>Sign out</button>
      </div>
    </header>
    <main>
      <p>
        Signed in{account ? ` as ${account.displayName}` : ''}. The editor comes in the next
        milestone.
      </p>
      <div class="row">
        <button class="secondary" disabled={checking} onclick={checkConnection}>
          {checking ? 'Checking…' : 'Check Drive connection'}
        </button>
        {#if import.meta.env.DEV}
          <button class="secondary" onclick={() => auth.invalidate()}>Expire token (dev)</button>
        {/if}
      </div>
      {#if checkResult}<p class="muted">{checkResult}</p>{/if}
      <DriveTestPanel />
    </main>
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
    gap: 12px;
    min-width: 0;
  }

  .email {
    overflow: hidden;
    color: var(--text-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  main {
    flex: 1;
    max-width: 720px;
    padding: 24px 16px;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
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

  .secondary:disabled {
    opacity: 0.6;
  }

  .muted {
    color: var(--text-muted);
  }
</style>
