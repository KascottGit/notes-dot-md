<!--
  Note header: editable title (renames the file), category picker (moves the
  file), save status, and export / pin / delete.
-->
<script lang="ts">
  import { isPinned, type Category } from '../drive/notes';
  import type { SessionState } from '../store/noteSession';
  import Icon from './Icon.svelte';
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
  const categoryName = $derived(
    categories.find((c) => c.id === sessionState.note.folderId)?.name ?? '',
  );
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

<!-- Joined to the format bar below it (no line between), except on read-only notes. -->
<div class="header" class:joined={!sessionState.readOnly}>
  <div class="inner">
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
        <!-- Sized to the current name; the transparent select on top takes the taps. -->
        <label class="category" title={sessionState.readOnly ? categoryName : 'Move to category'}>
          <span class="current">{categoryName}</span>
          {#if !sessionState.readOnly}<Icon name="chevronDown" size={14} />{/if}
          <select
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
        </label>
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
</div>
{#if sessionState.status === 'error' && sessionState.error}
  <p class="detail" role="alert">{sessionState.error} Your text is still here.</p>
{/if}

<style>
  .header {
    /* The same scrollbar space as the editor, so both center the same column. */
    overflow: hidden;
    border-bottom: 1px solid var(--border);
    scrollbar-gutter: stable;
  }

  .header.joined {
    border-bottom: 0;
  }

  /* Lined up with the note text below (same column as the editor). */
  .inner {
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 760px;
    min-height: 56px;
    margin: 0 auto;
    padding: 6px 6px 0 21px;
  }

  .back {
    display: none;
    margin-left: -10px;
  }

  @media (max-width: 899px) {
    .inner {
      padding-left: 16px;
    }

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
    position: relative;
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 2px;
    max-width: 60%;
    color: var(--text-muted);
    cursor: pointer;
  }

  .category:hover {
    color: var(--text);
  }

  .current {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .category select {
    position: absolute;
    /* A taller tap target than the text. */
    inset: -12px -4px;
    width: calc(100% + 8px);
    font-size: 16px;
    opacity: 0;
    cursor: pointer;
  }

  .category select:disabled {
    cursor: default;
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
