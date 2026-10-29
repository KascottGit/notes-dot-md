<script lang="ts">
  import { auth } from '../auth/google';
</script>

{#if $auth.status === 'expired'}
  <div class="banner" role="alert">
    <p>
      Your Google session expired. Nothing is lost: pending changes are saved once you sign in.
      {#if $auth.error}<span class="error">{$auth.error}</span>{/if}
    </p>
    <button disabled={$auth.busy} onclick={() => auth.signIn()}>
      {$auth.busy ? 'Signing in…' : 'Sign in again'}
    </button>
  </div>
{/if}

<style>
  .banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 16px;
    padding: 8px 16px;
    background: var(--warning-bg);
    border-bottom: 1px solid var(--border);
  }

  p {
    margin: 0;
    flex: 1 1 240px;
  }

  .error {
    display: block;
    color: var(--danger);
  }

  button {
    min-height: 44px;
    padding: 0 16px;
    border: 0;
    border-radius: 8px;
    background: var(--accent);
    color: var(--on-accent);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.6;
  }
</style>
