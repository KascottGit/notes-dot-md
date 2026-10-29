<script lang="ts">
  import type { Note } from '../drive/notes';

  interface Props {
    notes: Note[];
    selectedId: string | null;
    categoryName: (folderId: string) => string;
    loading: boolean;
    error: string | null;
    onOpen: (note: Note) => void;
    onNew: () => void;
  }

  let { notes, selectedId, categoryName, loading, error, onOpen, onNew }: Props = $props();

  const sorted = $derived([...notes].sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime)));

  const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
  const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });

  function when(iso: string): string {
    const date = new Date(iso);
    const today = new Date().toDateString() === date.toDateString();
    return today ? timeFormat.format(date) : dateFormat.format(date);
  }
</script>

<nav class="list" aria-label="Notes">
  <div class="top">
    <h2>All notes</h2>
    <button class="new" onclick={onNew} disabled={loading}>New note</button>
  </div>

  {#if error}
    <p class="message error" role="alert">{error}</p>
  {:else if loading}
    <p class="message">Loading notes…</p>
  {:else if sorted.length === 0}
    <p class="message">No notes yet. Create one to get started.</p>
  {:else}
    <ul>
      {#each sorted as note (note.id)}
        <li>
          <button
            class="item"
            class:selected={note.id === selectedId}
            aria-current={note.id === selectedId ? 'true' : undefined}
            onclick={() => onOpen(note)}
          >
            <span class="title">{note.title}</span>
            <span class="meta">{categoryName(note.folderId)} · {when(note.modifiedTime)}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</nav>

<style>
  .list {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
  }

  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 8px 8px 16px;
  }

  h2 {
    margin: 0;
    font-size: 1rem;
  }

  .new {
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

  .new:disabled {
    opacity: 0.6;
  }

  ul {
    flex: 1;
    margin: 0;
    padding: 0 8px 16px;
    overflow-y: auto;
    list-style: none;
  }

  .item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    min-height: 44px;
    padding: 8px 12px;
    border: 0;
    border-radius: 8px;
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .item:hover {
    background: var(--bg-muted);
  }

  .item.selected {
    background: var(--selection);
  }

  .title {
    overflow: hidden;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    color: var(--text-muted);
    font-size: 0.8125rem;
  }

  .message {
    margin: 0;
    padding: 8px 16px;
    color: var(--text-muted);
  }

  .error {
    color: var(--danger);
  }
</style>
