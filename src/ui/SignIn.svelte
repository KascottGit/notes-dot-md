<script lang="ts">
  import { auth } from '../auth/google';

  interface Props {
    onSignIn: (options?: { selectAccount?: boolean }) => void;
  }

  let { onSignIn }: Props = $props();
</script>

<div class="signin">
  <div class="card">
    <h1>notes.md</h1>
    <p class="muted">Markdown notes stored as plain <code>.md</code> files in your Google Drive.</p>

    <button class="primary" disabled={!$auth.ready || $auth.busy} onclick={() => onSignIn()}>
      {#if $auth.status === 'loading'}
        Loading…
      {:else if $auth.busy}
        Signing in…
      {:else if $auth.loginHint}
        Continue as {$auth.loginHint}
      {:else}
        Sign in with Google
      {/if}
    </button>

    {#if $auth.loginHint && $auth.ready}
      <button class="link" disabled={$auth.busy} onclick={() => onSignIn({ selectAccount: true })}>
        Use another account
      </button>
    {/if}

    {#if $auth.error}
      <p class="error" role="alert">{$auth.error}</p>
    {/if}

    <p class="fine">
      notes.md only sees files it creates in a <code>Notes</code> folder, not the rest of your Drive.
    </p>
  </div>
</div>

<style>
  .signin {
    display: grid;
    place-items: center;
    min-height: 100%;
    padding: 16px;
  }

  .card {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
    width: 100%;
    max-width: 360px;
    text-align: center;
  }

  h1 {
    margin: 0;
    font-size: 1.75rem;
  }

  p {
    margin: 0;
  }

  .muted {
    color: var(--text-muted);
  }

  .primary {
    min-height: 48px;
    margin-top: 12px;
    padding: 0 20px;
    border: 0;
    border-radius: 8px;
    background: var(--accent);
    color: var(--on-accent);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .link {
    min-height: 44px;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .error {
    color: var(--danger);
  }

  .fine {
    margin-top: 12px;
    color: var(--text-muted);
    font-size: 0.875rem;
  }

  code {
    font-family: var(--font-mono);
  }
</style>
