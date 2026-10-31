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
  import Icon from './Icon.svelte';
  import IconButton from './IconButton.svelte';
  import InlineName from './InlineName.svelte';
  import SwipeItem from './SwipeItem.svelte';

  interface Props {
    notes: Note[];
    /** Already in display order (General first). */
    categories: Category[];
    defaultId: string | null;
    /** null = All notes. */
    selectedCategory: string | null;
    selectedNoteId: string | null;
    sort: SortOrder;
    query: string;
    loading: boolean;
    error: string | null;
    onOpen: (note: Note) => void;
    onNew: () => void;
    onNewBoard: () => void;
    onSelectCategory: (id: string | null) => void;
    onSort: (sort: SortOrder) => void;
    onQuery: (query: string) => void;
    onNewCategory: () => void;
    /** Rename a category. Resolves when done (the name shows the final value). */
    onRenameCategory: (category: Category, name: string) => Promise<void>;
    onDeleteCategory: (category: Category) => void;
    onTogglePin: (note: Note) => void;
    onDeleteNote: (note: Note) => void;
  }

  let {
    notes,
    categories,
    defaultId,
    selectedCategory,
    selectedNoteId,
    sort,
    query,
    loading,
    error,
    onOpen,
    onNew,
    onNewBoard,
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
    <div class="row" class:selected={note.id === selectedNoteId}>
      <button
        class="item"
        aria-current={note.id === selectedNoteId ? 'true' : undefined}
        title={note.title}
        onclick={() => onOpen(note)}
      >
        <span class="title">
          {#if isPinned(note)}
            <span class="pin" title="Pinned"><Icon name="pin" size={14} filled /></span>
          {/if}
          {note.title}
        </span>
        <span class="meta">
          {when(note)}{#if selectedCategory === null}{` · ${categoryName(note.folderId)}`}{/if}
        </span>
      </button>
      <!-- With a mouse, pin and delete show on hover (touch screens swipe instead). -->
      {#if note.canEdit}
        <span class="hover-actions">
          <IconButton
            icon="pin"
            label={isPinned(note) ? 'Unpin note' : 'Pin note'}
            pressed={isPinned(note)}
            onclick={() => onTogglePin(note)}
          />
          <IconButton
            icon="trash"
            label="Delete note"
            title="Move to trash"
            onclick={() => onDeleteNote(note)}
          />
        </span>
      {/if}
    </div>
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
    <IconButton icon="board" label="New board" disabled={loading} onclick={onNewBoard} />
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
        <span class="label" title={c.name}>{c.name}</span>
        <span class="count">{counts.get(c.id) ?? 0}</span>
      </button>
    {/each}
    <button class="chip add" onclick={onNewCategory} disabled={loading} aria-label="New category">
      + Category
    </button>
  </div>

  <div class="bar">
    <div class="name">
      <InlineName
        value={current?.name ?? 'All notes'}
        label="Category name"
        readonly={!current || current.id === defaultId}
        onCommit={(name) => (current ? onRenameCategory(current, name) : Promise.resolve())}
      />
    </div>
    {#if current && current.id !== defaultId}
      <IconButton
        icon="trash"
        label={`Delete category ${current.name}`}
        title="Delete category"
        onclick={() => onDeleteCategory(current)}
      />
    {/if}
    <!-- An icon button so the category name keeps the room; the native menu opens on tap. -->
    <label class="sort" title={`Sort: ${SORT_LABELS[sort]}`}>
      <Icon name="sort" />
      <select
        aria-label={`Sort notes (now: ${SORT_LABELS[sort]})`}
        value={sort}
        onchange={(e) => onSort(e.currentTarget.value as SortOrder)}
      >
        {#each Object.entries(SORT_LABELS) as [value, label] (value)}
          <option {value}>{label}</option>
        {/each}
      </select>
    </label>
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

  /* Phones: one row that scrolls sideways, so the notes start higher. */
  @media (max-width: 899px) {
    .categories {
      flex-wrap: nowrap;
      overflow-x: auto;
      scrollbar-width: none;
    }

    .categories::-webkit-scrollbar {
      display: none;
    }

    .chip {
      flex: none;
      max-width: 70vw;
    }
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 34px;
    padding: 0 12px;
    border: 0;
    border-radius: 999px;
    background: var(--bg-muted);
    color: var(--text);
    font: inherit;
    font-size: 0.875rem;
    cursor: pointer;
    transition:
      background-color 120ms ease,
      color 120ms ease;
  }

  .chip:hover {
    background: var(--selection);
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

  .chip {
    max-width: 100%;
  }

  .chip .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chip.active {
    background: var(--accent);
    color: var(--on-accent);
  }

  .chip.active .count {
    color: inherit;
    opacity: 0.8;
  }

  .chip.add {
    background: none;
    color: var(--text-muted);
  }

  .chip.add:hover {
    background: var(--bg-muted);
    color: var(--text);
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

  .name {
    flex: 1;
    min-width: 0;
  }

  /* Same look as IconButton; the transparent select on top takes the taps. */
  .sort {
    position: relative;
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border-radius: 8px;
    color: var(--text-muted);
    cursor: pointer;
  }

  .sort:hover {
    background: var(--bg-muted);
    color: var(--text);
  }

  .sort select {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    font-size: 16px;
    opacity: 0;
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

  /* Desktop: notes as cards, two columns when the sidebar has room. */
  @media (min-width: 900px) {
    ul {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
      gap: 6px;
    }

    .row {
      border: 1px solid var(--border);
      border-radius: 8px;
    }
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
    display: inline-flex;
    margin-right: 4px;
    color: var(--pin);
    vertical-align: -1px;
  }

  .row {
    position: relative;
    border-radius: 8px;
    background: var(--bg);
    transition: background-color 120ms ease;
  }

  .row:hover {
    background: var(--bg-muted);
  }

  .row.selected {
    background: var(--selection);
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

  .hover-actions {
    display: none;
  }

  /* Only where there is a mouse: on touch screens nothing shows on hover. */
  @media (hover: hover) and (pointer: fine) {
    .hover-actions {
      position: absolute;
      top: 50%;
      right: 2px;
      display: flex;
      border-radius: 8px;
      /* The row's color, so the buttons cover the end of the title cleanly. */
      background: inherit;
      opacity: 0;
      pointer-events: none;
      transform: translateY(-50%);
    }

    .row:hover .hover-actions,
    .row:focus-within .hover-actions {
      opacity: 1;
      pointer-events: auto;
    }
  }

  .title {
    overflow: hidden;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    overflow: hidden;
    color: var(--text-muted);
    font-size: 0.8125rem;
    text-overflow: ellipsis;
    white-space: nowrap;
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
