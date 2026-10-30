<!--
  Note header: editable title (renames the file), category picker (moves the
  file), save status, and export / pin / delete.
-->
<script lang="ts">
  import { isPinned, type Category } from '../drive/notes';
  import type { SessionState } from '../store/noteSession';
  import IconButton from './IconButton.svelte';
  import InlineName from './InlineName.svelte';

  interface Props {
    sessionState: SessionState;
    categories: Category[];
    onBack: () => void;
    onRetry: () => void;
    /** Rename the note. Resolves when done (the title shows the final name). */
    onRename: (title: string) => Promise<void>;
    onMove: (folderId: string) => void;
    /** Enter in the title: go on to the text. */
    onDone: () => void;
    /** Download the note as a `.md` file. */
    onExport: () => void;
    onTogglePin: () => void;
    onDelete: () => void;
  }

  let {
    sessionState,
    categories,
    onBack,
    onRetry,
    onRename,
    onMove,
    onDone,
    onExport,
    onTogglePin,
    onDelete,
  }: Props = $props();

  const pinned = $derived(isPinned(sessionState.note));
  let title = $state<InlineName>();
  let renaming = $state(false);

  const label = $derived(
    sessionState.readOnly
      ? 'Read-only'
      : {
          saved: 'Saved',
          saving: 'Saving…',
          unsaved: 'Unsaved changes',
          error: "Couldn't save",
        }[sessionState.status],
  );

  /** Put the cursor in the title with all of it selected (for new notes). */
  export function focusTitle() {
    title?.focus();
  }
</script>

<div class="header">
  <span class="back"><IconButton icon="back" label="Back to notes" onclick={onBack} /></span>
  <div class="title">
    <InlineName
      bind:this={title}
      bind:busy={renaming}
      value={sessionState.note.title}
      label="Note title"
      readonly={sessionState.readOnly}
      onCommit={onRename}
      {onDone}
    />
    <div class="meta">
      <select
        class="category"
        aria-label="Category"
        value={sessionState.note.folderId}
        disabled={sessionState.readOnly}
        onchange={(e) => {
          const picked = e.currentTarget.value;
          // Show the real category until the move has gone through.
          e.currentTarget.value = sessionState.note.folderId;
          onMove(picked);
        }}
      >
        {#each categories as c (c.id)}
          <option value={c.id}>{c.name}</option>
        {/each}
      </select>
      <!-- Under the title, so the title keeps the width of the row. -->
      <div class="status" class:error={sessionState.status === 'error'} role="status">
        <span>{renaming ? 'Renaming…' : label}</span>
        {#if sessionState.status === 'error'}
          <button class="retry" onclick={onRetry}>Retry</button>
        {/if}
      </div>
    </div>
  </div>
  <span class="actions">
    <IconButton icon="download" label="Export as .md" onclick={onExport} />
    {#if !sessionState.readOnly}
      <IconButton
        icon="pin"
        label={pinned ? 'Unpin note' : 'Pin note'}
        pressed={pinned}
        onclick={onTogglePin}
      />
      <IconButton icon="trash" label="Delete note" title="Move to trash" onclick={onDelete} />
    {/if}
  </span>
</div>
{#if sessionState.status === 'error' && sessionState.error}
  <p class="detail" role="alert">{sessionState.error} Your text is still here.</p>
{/if}

<style>
  .header {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 56px;
    padding: 4px 10px 4px 16px;
    border-bottom: 1px solid var(--border);
  }

  .back {
    display: none;
    margin-left: -10px;
  }

  @media (max-width: 899px) {
    .back {
      display: inline-flex;
    }
  }

  .title {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    font-size: 0.8125rem;
  }

  .category {
    flex: none;
    max-width: 60%;
    margin-left: -4px;
    padding: 0 2px;
    border: 0;
    background: none;
    color: var(--text-muted);
    font: inherit;
    cursor: pointer;
  }

  .status {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .status > span {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .status::before {
    content: '·';
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

  .actions {
    display: inline-flex;
    flex: none;
  }

  .detail {
    margin: 0;
    padding: 8px 16px;
    background: var(--warning-bg);
    font-size: 0.875rem;
  }
</style>
