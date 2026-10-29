<!-- The note list: search, category filter, sort, and the notes themselves. -->
<script lang="ts">
  import { isPinned, type Category, type Note } from '../drive/notes';
  import {
    countByCategory,
    filterNotes,
    SORT_LABELS,
    sortNotes,
    splitPinned,
    type SortOrder,
  } from '../store/noteList';
  import SwipeItem from './SwipeItem.svelte';

  interface Props {
    notes: Note[];
    /** Already in display order (Inbox first). */
    categories: Category[];
    inboxId: string | null;
    /** null = All notes. */
    selectedCategory: string | null;
    selectedNoteId: string | null;
    sort: SortOrder;
    query: string;
    loading: boolean;
    error: string | null;
    onOpen: (note: Note) => void;
    onNew: () => void;
    onSelectCategory: (id: string | null) => void;
    onSort: (sort: SortOrder) => void;
    onQuery: (query: string) => void;
    onNewCategory: () => void;
    onRenameCategory: (category: Category) => void;
    onDeleteCategory: (category: Category) => void;
    onTogglePin: (note: Note) => void;
    onDeleteNote: (note: Note) => void;
  }

  let {
    notes,
    categories,
    inboxId,
    selectedCategory,
    selectedNoteId,
    sort,
    query,
    loading,
    error,
    onOpen,
    onNew,
    onSelectCategory,
    onSort,
    onQuery,
    onNewCategory,
    onRenameCategory,
    onDeleteCategory,
    onTogglePin,
    onDeleteNote,
  }: Props = $props();

  const counts = $derived(countByCategory(notes));
  const shown = $derived(sortNotes(filterNotes(notes, selectedCategory, query), sort));
  const groups = $derived(splitPinned(shown));
  const current = $derived(categories.find((c) => c.id === selectedCategory) ?? null);
  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? '';

  const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
  const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });

  function when(note: Note): string {
    const iso = sort === 'created' ? note.createdTime : note.modifiedTime;
    const date = new Date(iso);
    const today = new Date().toDateString() === date.toDateString();
    return today ? timeFormat.format(date) : dateFormat.format(date);
  }
</script>

{#snippet row(note: Note)}
  <SwipeItem
    pinned={isPinned(note)}
    disabled={!note.canEdit}
    onPin={() => onTogglePin(note)}
    onDelete={() => onDeleteNote(note)}
  >
    <button
      class="item"
      class:selected={note.id === selectedNoteId}
      aria-current={note.id === selectedNoteId ? 'true' : undefined}
      onclick={() => onOpen(note)}
    >
      <span class="title">
        {#if isPinned(note)}
          <svg class="pin" viewBox="0 0 24 24" aria-label="Pinned" role="img"
            ><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3zM12 15v5" /></svg
          >
        {/if}
        {note.title}
      </span>
      <span class="meta">
        {#if selectedCategory === null}{categoryName(note.folderId)} ·{/if}
        {when(note)}
      </span>
    </button>
  </SwipeItem>
{/snippet}

<nav class="list" aria-label="Notes">
  <div class="top">
    <input
      class="search"
      type="search"
      placeholder="Search titles"
      aria-label="Search note titles"
      value={query}
      oninput={(e) => onQuery(e.currentTarget.value)}
    />
    <button class="new" onclick={onNew} disabled={loading}>New note</button>
  </div>

  <div class="categories" role="group" aria-label="Categories">
    <button
      class="chip"
      class:active={selectedCategory === null}
      aria-pressed={selectedCategory === null}
      onclick={() => onSelectCategory(null)}
    >
      All notes <span class="count">{notes.length}</span>
    </button>
    {#each categories as c (c.id)}
      <button
        class="chip"
        class:active={selectedCategory === c.id}
        aria-pressed={selectedCategory === c.id}
        onclick={() => onSelectCategory(c.id)}
      >
        {c.name} <span class="count">{counts.get(c.id) ?? 0}</span>
      </button>
    {/each}
    <button class="chip add" onclick={onNewCategory} disabled={loading} aria-label="New category">
      + Category
    </button>
  </div>

  <div class="bar">
    <h2>{current?.name ?? 'All notes'}</h2>
    {#if current && current.id !== inboxId}
      <button class="small" onclick={() => onRenameCategory(current)}>Rename</button>
      <button class="small" onclick={() => onDeleteCategory(current)}>Delete</button>
    {/if}
    <select
      class="sort"
      aria-label="Sort notes"
      value={sort}
      onchange={(e) => onSort(e.currentTarget.value as SortOrder)}
    >
      {#each Object.entries(SORT_LABELS) as [value, label] (value)}
        <option {value}>{label}</option>
      {/each}
    </select>
  </div>

  {#if error}
    <p class="message error" role="alert">{error}</p>
  {:else if loading}
    <p class="message">Loading notes…</p>
  {:else if shown.length === 0}
    <p class="message">
      {query ? 'No titles match your search.' : 'No notes here yet. Create one to get started.'}
    </p>
  {:else}
    <div class="notes">
      {#if groups.pinned.length}
        <h3>Pinned</h3>
        <ul>
          {#each groups.pinned as note (note.id)}
            <li>{@render row(note)}</li>
          {/each}
        </ul>
        {#if groups.others.length}<h3>Notes</h3>{/if}
      {/if}
      <ul>
        {#each groups.others as note (note.id)}
          <li>{@render row(note)}</li>
        {/each}
      </ul>
    </div>
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
    gap: 8px;
    padding: 8px;
  }

  .search {
    flex: 1;
    min-width: 0;
    min-height: 44px;
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-muted);
    color: var(--text);
    font: inherit;
    font-size: 16px;
  }

  .new {
    flex: none;
    min-height: 44px;
    padding: 0 14px;
    border: 0;
    border-radius: 8px;
    background: var(--accent);
    color: var(--on-accent);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  .categories {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 0 8px 8px;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 36px;
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 0.875rem;
    cursor: pointer;
  }

  /* Still a 44px touch target. */
  .chip {
    position: relative;
  }

  .chip::after {
    content: '';
    position: absolute;
    inset: -4px -2px;
  }

  .chip.active {
    border-color: var(--accent);
    background: var(--selection);
  }

  .chip.add {
    color: var(--text-muted);
    border-style: dashed;
  }

  .count {
    color: var(--text-muted);
    font-size: 0.8125rem;
    font-variant-numeric: tabular-nums;
  }

  .bar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px 4px 16px;
    border-top: 1px solid var(--border);
  }

  h2 {
    flex: 1;
    min-width: 0;
    margin: 0;
    overflow: hidden;
    font-size: 1rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .small {
    min-height: 44px;
    padding: 0 8px;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    font-size: 0.875rem;
    cursor: pointer;
  }

  .sort {
    min-height: 44px;
    padding: 0 8px;
    border: 0;
    background: none;
    color: var(--text-muted);
    font: inherit;
    font-size: 0.875rem;
    cursor: pointer;
  }

  .notes {
    flex: 1;
    min-height: 0;
    padding: 0 8px 16px;
    overflow-y: auto;
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  h3 {
    margin: 8px 12px 4px;
    color: var(--text-muted);
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .pin {
    flex: none;
    width: 14px;
    height: 14px;
    margin-right: 4px;
    vertical-align: -1px;
    fill: none;
    stroke: var(--pin);
    stroke-width: 2.2;
    stroke-linecap: round;
    stroke-linejoin: round;
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

  button:disabled {
    opacity: 0.6;
  }
</style>
