<script lang="ts">
  import { auth } from '../auth/google';
</script>

{#if $auth.status === 'expired'}
  <div class="banner" role="alert">
    <p>
      Your Google session expired. Continue to renew it; the page reloads briefly and unsaved text
      is kept.
    </p>
    <button disabled={$auth.busy} onclick={() => auth.renew()}>
      {$auth.busy ? 'Renewing…' : 'Continue'}
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
