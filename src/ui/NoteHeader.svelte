<script lang="ts">
  import type { SessionState } from '../store/noteSession';

  interface Props {
    state: SessionState;
    categoryName: string;
    onBack: () => void;
    onRetry: () => void;
  }

  let { state, categoryName, onBack, onRetry }: Props = $props();

  const label = $derived(
    state.readOnly
      ? 'Read-only'
      : {
          saved: 'Saved',
          saving: 'Saving…',
          unsaved: 'Unsaved changes',
          error: "Couldn't save",
        }[state.status],
  );
</script>

<div class="header">
  <button class="back" onclick={onBack} aria-label="Back to notes">←</button>
  <div class="title">
    <h2>{state.note.title}</h2>
    <span class="category">{categoryName}</span>
  </div>
  <div class="status" class:error={state.status === 'error'} role="status">
    <span>{label}</span>
    {#if state.status === 'error'}
      <button class="retry" onclick={onRetry}>Retry</button>
    {/if}
  </div>
</div>
{#if state.status === 'error' && state.error}
  <p class="detail" role="alert">{state.error} Your text is still here.</p>
{/if}

<style>
  .header {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 56px;
    padding: 4px 16px;
    border-bottom: 1px solid var(--border);
  }

  .back {
    display: none;
    min-width: 44px;
    min-height: 44px;
    margin-left: -8px;
    border: 0;
    border-radius: 8px;
    background: none;
    color: var(--text);
    font-size: 1.25rem;
    cursor: pointer;
  }

  @media (max-width: 899px) {
    .back {
      display: block;
    }
  }

  .title {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }

  h2 {
    margin: 0;
    overflow: hidden;
    font-size: 1.0625rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .category {
    color: var(--text-muted);
    font-size: 0.8125rem;
  }

  .status {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-muted);
    font-size: 0.875rem;
    white-space: nowrap;
  }

  .status.error {
    color: var(--danger);
  }

  .retry {
    min-height: 44px;
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-muted);
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }

  .detail {
    margin: 0;
    padding: 8px 16px;
    background: var(--warning-bg);
    font-size: 0.875rem;
  }
</style>
