<!-- The note list: search, category filter, sort, and the notes themselves. -->
<script lang="ts">
  import { isBoardNote, isPinned, notePreview, type Category, type Note } from '../drive/notes';
  import {
    countByCategory,
    filterNotes,
    searchResults,
    SORT_LABELS,
    sortNotes,
    splitPinned,
    type SortOrder,
  } from '../store/noteList';
  import Chip from './Chip.svelte';
  import ChipRow from './ChipRow.svelte';
  import Icon from './Icon.svelte';
  import IconButton from './IconButton.svelte';
  import InlineName from './InlineName.svelte';
  import Menu from './Menu.svelte';
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
    /** Ids of notes whose text matches the query (full-text search). */
    textMatches: string[];
    /** The full-text search is running. */
    searching: boolean;
    /** The full-text search failed (titles still work). */
    searchFailed: boolean;
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
    /** A note dragged onto a category chip. */
    onMoveNote: (note: Note, folderId: string) => void;
  }

  let {
    notes,
    categories,
    defaultId,
    selectedCategory,
    selectedNoteId,
    sort,
    query,
    textMatches,
    searching,
    searchFailed,
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
    onMoveNote,
  }: Props = $props();

  const counts = $derived(countByCategory(notes));
  const shown = $derived(sortNotes(filterNotes(notes, selectedCategory, query), sort));
  const groups = $derived(splitPinned(shown));
  const searchingNow = $derived(query.trim() !== '');
  const found = $derived(searchResults(notes, selectedCategory, query, textMatches, sort));
  const current = $derived(categories.find((c) => c.id === selectedCategory) ?? null);
  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? '';

  const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
  const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });

  /** What the New button can make. */
  const NEW_ITEMS = [
    { id: 'note', label: 'Note', icon: 'text' },
    { id: 'board', label: 'Board', icon: 'board' },
  ] as const;
  let newOpen = $state(false);
  let newButton = $state<HTMLButtonElement>();

  // ---------------------------------------------------------- Drag onto a category

  /** Touch: hold this long (without moving) before a note starts to drag, so scrolling still works. */
  const HOLD_MS = 300;
  const SLOP = 8;

  let nav = $state<HTMLElement>();
  let press: {
    note: Note;
    pointerId: number;
    x: number;
    y: number;
    touch: boolean;
    timer: ReturnType<typeof setTimeout> | null;
  } | null = null;
  /** The note being dragged, its ghost's place, and the category under the pointer. */
  let dragNote = $state<Note | null>(null);
  let ghost = $state({ x: 0, y: 0, touch: false });
  let overId = $state<string | null>(null);
  let frame = 0;
  const overName = $derived(overId ? categoryName(overId) : '');
  let ghostEl = $state<HTMLElement>();
  /**
   * Where the ghost goes, kept on the screen: with a mouse below and right of
   * the pointer, like a cursor label; on touch above the finger, which would
   * hide it.
   */
  const ghostAt = $derived.by(() => {
    const w = ghostEl?.offsetWidth ?? 0;
    const h = ghostEl?.offsetHeight ?? 0;
    const x = ghost.touch ? ghost.x - w / 2 : ghost.x + 14;
    const y = ghost.touch ? ghost.y - h - 36 : ghost.y + 14;
    return {
      x: Math.max(8, Math.min(x, window.innerWidth - w - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - h - 8)),
    };
  });

  /** How a chip looks while a note is dragged (nothing when none is). */
  function dropState(id: string | null): 'ready' | 'over' | 'off' | undefined {
    if (!dragNote) return undefined;
    if (id === null || id === dragNote.folderId) return 'off';
    return id === overId ? 'over' : 'ready';
  }

  function startPress(event: PointerEvent, note: Note) {
    if (!note.canEdit || event.button !== 0 || press || dragNote) return;
    const touch = event.pointerType !== 'mouse';
    if (!touch) event.preventDefault(); // No text selection while dragging.
    press = {
      note,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      touch,
      timer: null,
    };
    if (touch) press.timer = setTimeout(() => press && beginDrag(press.x, press.y), HOLD_MS);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', stopDrag);
    window.addEventListener('touchmove', blockScroll, { passive: false });
    window.addEventListener('keydown', onKeydown);
  }

  function beginDrag(x: number, y: number) {
    if (!press) return;
    if (press.timer) clearTimeout(press.timer);
    dragNote = press.note;
    ghost = { x, y, touch: press.touch };
    press = null;
    document.getSelection()?.removeAllRanges();
    navigator.vibrate?.(10);
    frame = requestAnimationFrame(autoScroll);
  }

  function onPointerMove(event: PointerEvent) {
    if (dragNote) {
      ghost = { ...ghost, x: event.clientX, y: event.clientY };
      overId = categoryAt(event.clientX, event.clientY);
      return;
    }
    if (!press || event.pointerId !== press.pointerId) return;
    const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y);
    if (press.touch) {
      if (moved > SLOP) stopDrag(); // A scroll or a swipe, not a hold.
    } else if (moved > 5) {
      beginDrag(press.x, press.y);
      onPointerMove(event);
    }
  }

  function onPointerUp() {
    const note = dragNote;
    const to = overId;
    stopDrag();
    if (!note) return; // A plain tap or click: it opens the note as usual.
    // The release must not also open the note it started on.
    const swallow = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, true), 0);
    if (to) onMoveNote(note, to);
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') stopDrag();
  }

  /** Once a drag runs, the list must not scroll under the finger. */
  function blockScroll(event: TouchEvent) {
    if (dragNote && event.cancelable) event.preventDefault();
  }

  function stopDrag() {
    if (press?.timer) clearTimeout(press.timer);
    press = null;
    dragNote = null;
    overId = null;
    cancelAnimationFrame(frame);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', stopDrag);
    window.removeEventListener('touchmove', blockScroll);
    window.removeEventListener('keydown', onKeydown);
  }

  /** The category chip under a point, unless it is the note's own category. */
  function categoryAt(x: number, y: number): string | null {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop]');
    const id = el?.dataset['drop'] ?? null;
    return id && id !== dragNote?.folderId ? id : null;
  }

  /** On phones the chips scroll sideways: near the row's ends, it scrolls on. */
  function autoScroll() {
    if (!dragNote) return;
    const row = nav?.querySelector<HTMLElement>('[data-drop]')?.parentElement;
    if (row && row.scrollWidth > row.clientWidth) {
      const r = row.getBoundingClientRect();
      const { x, y } = ghost;
      if (y > r.top - 24 && y < r.bottom + 24) {
        const before = row.scrollLeft;
        if (x < r.left + 48) row.scrollLeft -= 8;
        else if (x > r.right - 48) row.scrollLeft += 8;
        if (row.scrollLeft !== before) overId = categoryAt(x, y);
      }
    }
    frame = requestAnimationFrame(autoScroll);
  }

  /** Puts the ghost on the page itself, so a sliding (transformed) list can't move it. */
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }

  $effect(() => stopDrag);

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
    disabled={!note.canEdit || dragNote?.id === note.id}
    onPin={() => onTogglePin(note)}
    onDelete={() => onDeleteNote(note)}
  >
    <div
      class="row reveal-host"
      class:selected={note.id === selectedNoteId}
      class:dragged={dragNote?.id === note.id}
    >
      <!-- Drag it (press and hold on touch screens) onto a category chip to move it there. -->
      <button
        class="item"
        aria-current={note.id === selectedNoteId ? 'true' : undefined}
        title={note.title}
        onclick={() => onOpen(note)}
        onpointerdown={(e) => startPress(e, note)}
      >
        <span class="title">
          {#if isPinned(note)}
            <span class="pin" title="Pinned"><Icon name="pin" size={14} filled /></span>
          {/if}
          {note.title}
        </span>
        <!-- Always the line's room (empty for boards and empty notes), so all cards are the same height. -->
        <span class="preview" aria-hidden={!notePreview(note) || isBoardNote(note)}>
          {isBoardNote(note) ? '\u00a0' : notePreview(note) || '\u00a0'}
        </span>
        <!-- Board or note: the same icons as the header's switch between board and text. -->
        {#snippet kind()}
          <span
            class="kind"
            role="img"
            aria-label={isBoardNote(note) ? 'Board' : 'Note'}
            title={isBoardNote(note) ? 'Board' : 'Note'}
          >
            <Icon name={isBoardNote(note) ? 'board' : 'text'} size={13} />
          </span>
        {/snippet}
        <span class="meta">
          {#if selectedCategory === null}
            {when(note)} · {@render kind()}{categoryName(note.folderId)}
          {:else}
            {@render kind()}{when(note)}
          {/if}
        </span>
      </button>
      <!-- With a mouse, pin and delete show on hover (touch screens swipe instead). -->
      {#if note.canEdit}
        <span class="hover-actions reveal mouse-only">
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

<nav class="list" aria-label="Notes" bind:this={nav}>
  <div class="top">
    <input
      class="search"
      type="search"
      placeholder="Search"
      aria-label="Search notes"
      value={query}
      oninput={(e) => onQuery(e.currentTarget.value)}
    />
    <div class="new-wrap">
      <button
        bind:this={newButton}
        class="new"
        aria-haspopup="menu"
        aria-expanded={newOpen}
        disabled={loading}
        onclick={() => (newOpen = !newOpen)}
      >
        New <Icon name="chevronDown" size={16} />
      </button>
      {#if newOpen}
        <Menu
          items={[...NEW_ITEMS]}
          label="New"
          anchor={newButton}
          onSelect={(item) => (item.id === 'board' ? onNewBoard() : onNew())}
          onClose={() => (newOpen = false)}
        >
          {#snippet item(it)}
            <span class="new-item"><Icon name={it.icon} />{it.label}</span>
          {/snippet}
        </Menu>
      {/if}
    </div>
  </div>

  <ChipRow label="Categories">
    <Chip
      label="All notes"
      count={loading ? undefined : notes.length}
      active={selectedCategory === null}
      drop={dropState(null)}
      onclick={() => onSelectCategory(null)}
    />
    {#each categories as c (c.id)}
      <Chip
        label={c.name}
        count={counts.get(c.id) ?? 0}
        active={selectedCategory === c.id}
        dropId={c.id}
        drop={dropState(c.id)}
        onclick={() => onSelectCategory(c.id)}
      />
    {/each}
    <Chip
      label="+ Category"
      variant="add"
      ariaLabel="New category"
      disabled={loading}
      drop={dropState(null)}
      onclick={onNewCategory}
    />
  </ChipRow>

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
    <!-- Placeholder cards in the shape of notes, so nothing jumps when they arrive. -->
    <div class="notes" aria-busy="true">
      <p class="visually-hidden">Loading notes…</p>
      <ul class="placeholders" aria-hidden="true">
        {#each [72, 48, 86, 60, 40, 78] as width, i (i)}
          <li class="row placeholder">
            <span class="line title-line" style:width={`${width}%`}></span>
            <span class="line preview-line"></span>
            <span class="line meta-line"></span>
          </li>
        {/each}
      </ul>
    </div>
  {:else if searchingNow}
    <!-- Title matches first, then notes found only in their text. -->
    <div class="notes">
      {#if found.titles.length}
        <ul>
          {#each found.titles as note (note.id)}
            <li>{@render row(note)}</li>
          {/each}
        </ul>
      {/if}
      {#if found.text.length}
        <h3>In note text</h3>
        <ul>
          {#each found.text as note (note.id)}
            <li>{@render row(note)}</li>
          {/each}
        </ul>
      {/if}
      {#if searching}
        <p class="message">Searching note text…</p>
      {:else if searchFailed}
        <p class="message">Couldn't search note text. Only titles are shown.</p>
      {:else if !found.titles.length && !found.text.length}
        <p class="message">No notes match your search.</p>
      {/if}
    </div>
  {:else if shown.length === 0}
    <p class="message">No notes here yet. Create one to get started.</p>
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

{#if dragNote}
  <div
    class="ghost"
    bind:this={ghostEl}
    use:portal
    style:transform={`translate(${ghostAt.x}px, ${ghostAt.y}px)`}
    aria-hidden="true"
  >
    <span class="ghost-title">
      <Icon name={isBoardNote(dragNote) ? 'board' : 'text'} size={14} />
      <span>{dragNote.title}</span>
    </span>
    <span class="ghost-to" class:none={!overName}>
      {overName ? `Move to ${overName}` : 'Drop on a category'}
    </span>
  </div>
{/if}

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

  .new-wrap {
    position: relative;
    flex: none;
  }

  .new {
    display: inline-flex;
    gap: 4px;
    align-items: center;
    min-height: 44px;
    padding: 0 10px 0 14px;
    border: 0;
    border-radius: 8px;
    background: var(--accent);
    color: var(--on-accent);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  .new-item {
    display: inline-flex;
    gap: 10px;
    align-items: center;
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

  /* Only with a mouse: phones keep a "hover" on the last tapped row. */
  @media (hover: hover) and (pointer: fine) {
    .row:hover {
      background: var(--bg-muted);
    }
  }

  /*
   * The open note, beside the list on wider screens. Phones show the list only
   * when no note is open, so there it would look like a row stuck pressed.
   */
  @media (min-width: 900px) {
    .row.selected {
      background: var(--selection);
    }
  }

  /* The note being dragged stays in place, faded. */
  .row.dragged {
    opacity: 0.4;
  }

  /* A label that follows the pointer while a note is dragged onto a category. */
  .ghost {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-width: min(260px, calc(100vw - 32px));
    padding: 8px 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg);
    box-shadow: 0 8px 24px rgb(0 0 0 / 22%);
    font-size: 0.875rem;
    pointer-events: none;
  }

  .ghost-title {
    display: flex;
    gap: 6px;
    align-items: center;
    min-width: 0;
    font-weight: 500;
  }

  .ghost-title > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ghost-to {
    color: var(--accent);
    font-size: 0.8125rem;
  }

  .ghost-to.none {
    color: var(--text-muted);
  }

  .item {
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
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

  /* Pin and delete sweep in at the top right on hover (app.css .reveal), over the title's end. */
  .hover-actions {
    position: absolute;
    top: 2px;
    right: 2px;
    --reveal-width: 88px;
    border-radius: 8px;
    /* The row's color, so the buttons cover the end of the title cleanly. */
    background: inherit;
  }

  .title {
    overflow: hidden;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .preview {
    overflow: hidden;
    color: var(--text-muted);
    font-size: 0.875rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .kind {
    display: inline-flex;
    margin-right: 3px;
    vertical-align: -2px;
  }

  .meta {
    overflow: hidden;
    color: var(--text-muted);
    font-size: 0.8125rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Shown only if loading takes a moment, so quick loads don't flash. */
  .placeholders {
    animation: placeholders-in 220ms ease-out 250ms backwards;
  }

  @keyframes placeholders-in {
    from {
      opacity: 0;
    }
  }

  /* The same box as a note (.item): padding, title line and date line. */
  .placeholder {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 44px;
    padding: 14px 12px 15px;
  }

  .placeholder:hover {
    background: var(--bg);
  }

  .line {
    display: block;
    border-radius: 6px;
    background: var(--bg-muted);
  }

  .title-line {
    height: 12px;
  }

  .preview-line {
    width: 80%;
    height: 10px;
  }

  .meta-line {
    width: 45%;
    height: 10px;
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
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
