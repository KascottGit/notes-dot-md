<!--
  Note header: editable title (renames the file), category picker (moves the
  file), and the save status.
-->
<script lang="ts">
  import type { Category } from '../drive/notes';
  import type { SessionState } from '../store/noteSession';

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
  }

  let { sessionState, categories, onBack, onRetry, onRename, onMove, onDone }: Props = $props();

  let input = $state<HTMLInputElement>();
  let draft = $state('');
  let editing = $state(false);
  let renaming = $state(false);

  // Show the current title, except while the user is typing or a rename is on its way.
  $effect(() => {
    const title = sessionState.note.title;
    if (!editing && !renaming) draft = title;
  });

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
    input?.focus();
    input?.select();
  }

  async function commit() {
    const title = draft.trim();
    if (!title || title === sessionState.note.title) {
      editing = false;
      draft = sessionState.note.title;
      return;
    }
    renaming = true;
    editing = false;
    try {
      await onRename(title);
    } finally {
      // The field then shows the final name (it may differ, e.g. "Plan (2)").
      renaming = false;
    }
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      input?.blur(); // Commits via blur.
      onDone();
    } else if (event.key === 'Escape') {
      draft = sessionState.note.title;
      editing = false;
      input?.blur();
    }
  }
</script>

<div class="header">
  <button class="back" onclick={onBack} aria-label="Back to notes">←</button>
  <div class="title">
    <input
      bind:this={input}
      class="name"
      aria-label="Note title"
      bind:value={draft}
      readonly={sessionState.readOnly || renaming}
      enterkeyhint="done"
      autocomplete="off"
      spellcheck="false"
      onfocus={() => (editing = true)}
      onblur={commit}
      onkeydown={onKeydown}
    />
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
  </div>
  <div class="status" class:error={sessionState.status === 'error'} role="status">
    <span>{renaming ? 'Renaming…' : label}</span>
    {#if sessionState.status === 'error'}
      <button class="retry" onclick={onRetry}>Retry</button>
    {/if}
  </div>
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

  .name {
    width: 100%;
    min-width: 0;
    padding: 2px 6px;
    margin-left: -6px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: none;
    color: var(--text);
    font-family: var(--font-heading);
    /* 16px+ so focusing it never zooms on phones. */
    font-size: 1.0625rem;
    font-weight: 600;
    text-overflow: ellipsis;
  }

  .name:hover:not([readonly]) {
    border-color: var(--border);
  }

  .name:focus {
    border-color: var(--accent);
    outline: none;
  }

  .category {
    align-self: flex-start;
    max-width: 100%;
    margin-left: -4px;
    padding: 0 2px;
    border: 0;
    background: none;
    color: var(--text-muted);
    font: inherit;
    font-size: 0.8125rem;
    cursor: pointer;
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
