<!--
  Note header: editable title (renames the file), category picker (moves the
  file), save status, and tags / export / pin / delete.
-->
<script lang="ts">
  import { isPinned, type Category } from '../drive/notes';
  import type { Heading, Outline } from '../editor/outline';
  import type { SessionState } from '../store/noteSession';
  import Icon from './Icon.svelte';
  import type { IconName } from './icons';
  import IconButton from './IconButton.svelte';
  import InlineName from './InlineName.svelte';
  import Menu from './Menu.svelte';

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
    /** The number of words in the note, shown after the save status. Null: not shown (boards). */
    words?: number | null;
    /** Make a copy of the note next to it, and open that. */
    onDuplicate?: (() => void) | undefined;
    /** Open the find bar (notes shown as text; not on boards). */
    onFind?: (() => void) | undefined;
    /** The number of headings in the note: the outline shows from two on. */
    headings?: number;
    /** The note's outline, read when it opens. Undefined where there is none (board view). */
    readOutline?: (() => Outline) | undefined;
    /** Go to a heading picked in the outline. */
    onJump?: (heading: Heading) => void;
    /** Open this note's Tags list (its saved tags and their colors). */
    onTags?: () => void;
    /** Board files: shown as a board, or as text. Null for other notes. */
    boardView?: 'board' | 'text' | null;
    onToggleBoard?: () => void;
    /** Wider screens: the note list is shown (false: hidden). */
    sidebarOpen?: boolean;
    /** Wider screens: show or hide the note list. */
    onToggleSidebar?: () => void;
    /**
     * 'loading' / 'failed': the note's text is still loading (or failed to):
     * show it, but nothing can be changed yet. 'creating': a new note whose
     * file is being created; the title can be typed, the actions wait.
     */
    opening?: 'loading' | 'failed' | 'creating' | null;
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
    words = null,
    onFind,
    onDuplicate,
    headings = 0,
    readOutline,
    onJump,
    onTags,
    boardView = null,
    onToggleBoard,
    sidebarOpen = true,
    onToggleSidebar,
    opening = null,
  }: Props = $props();

  const loading = $derived(opening !== null);
  const locked = $derived(sessionState.readOnly || opening === 'loading' || opening === 'failed');

  const pinned = $derived(isPinned(sessionState.note));
  const categoryName = $derived(
    categories.find((c) => c.id === sessionState.note.folderId)?.name ?? '',
  );
  let title = $state<InlineName>();
  let renaming = $state(false);

  const label = $derived(
    opening === 'loading'
      ? 'Opening…'
      : opening === 'creating'
        ? 'Creating…'
        : opening === 'failed'
          ? "Couldn't open"
          : sessionState.readOnly
            ? 'Read-only'
            : {
                saved: 'Saved',
                saving: 'Saving…',
                unsaved: 'Unsaved changes',
                error: "Couldn't save",
              }[sessionState.status],
  );

  /** Phones (under 600px wide), where the header has less room. */
  const phone = window.matchMedia('(max-width: 599px)');
  let narrow = $state(phone.matches);
  $effect(() => {
    const update = () => (narrow = phone.matches);
    phone.addEventListener('change', update);
    return () => phone.removeEventListener('change', update);
  });

  const hasOutline = $derived(!!readOutline && !!onJump && headings >= 2 && !loading);

  interface MoreItem {
    id: 'outline' | 'find' | 'duplicate' | 'export' | 'delete';
    label: string;
    icon: IconName;
    run: () => void;
  }
  /**
   * The "more" menu: what has no button of its own (Find in note, Duplicate). On phones Outline,
   * Export and Delete sit here too, so the title keeps its room.
   */
  const moreItems = $derived.by(() => {
    const items: MoreItem[] = [];
    if (narrow && hasOutline) {
      items.push({ id: 'outline', label: 'Outline', icon: 'outline', run: openOutline });
    }
    if (onFind) items.push({ id: 'find', label: 'Find in note', icon: 'search', run: onFind });
    if (onDuplicate) {
      items.push({ id: 'duplicate', label: 'Duplicate', icon: 'copy', run: onDuplicate });
    }
    if (narrow && !sessionState.readOnly) {
      items.push({ id: 'export', label: 'Export as .md', icon: 'download', run: onExport });
      items.push({ id: 'delete', label: 'Move to trash', icon: 'trash', run: onDelete });
    }
    return items;
  });
  let moreOpen = $state(false);
  let moreButton = $state<HTMLElement>();

  /** The outline as it was when it opened: its headings, as menu items. */
  let outlineItems = $state<(Heading & { id: string; label: string })[] | null>(null);
  let outlineCurrent = $state<string | undefined>();
  let outlineButton = $state<HTMLElement>();
  /** Indent each heading by its level, from the highest level in the note. */
  const topLevel = $derived(Math.min(...(outlineItems ?? []).map((h) => h.level)));

  /** The note the outline was read from. */
  let outlineNote = '';
  // Gone when another note opens, or this one shows as a board.
  $effect(() => {
    if (outlineItems && (!hasOutline || sessionState.note.id !== outlineNote)) outlineItems = null;
  });

  /** Show the note's headings to jump to (also Ctrl+Shift+O in the editor). */
  export function openOutline() {
    if (!hasOutline || !readOutline) return;
    const { headings: list, current } = readOutline();
    moreOpen = false;
    outlineNote = sessionState.note.id;
    outlineItems = list.map((h) => ({ ...h, id: String(h.from), label: h.text }));
    outlineCurrent = current >= 0 ? String(list[current]!.from) : undefined;
  }

  /** Put the cursor in the title with all of it selected (for new notes). */
  export function focusTitle() {
    title?.focus();
  }
</script>

<!-- Joined to the format bar below it (no line between), except on read-only notes. -->
<div class="header" class:joined={!sessionState.readOnly}>
  <div class="inner">
    <span class="back"><IconButton icon="back" label="Back to notes" onclick={onBack} /></span>
    {#if onToggleSidebar}
      <span class="sidebar">
        <IconButton
          icon="sidebar"
          label={sidebarOpen ? 'Hide note list' : 'Show note list'}
          onclick={onToggleSidebar}
        />
      </span>
    {/if}
    <div class="title">
      <InlineName
        bind:this={title}
        bind:busy={renaming}
        value={sessionState.note.title}
        label="Note title"
        readonly={locked}
        onCommit={onRename}
        {onDone}
      />
      <div class="meta">
        <!-- Sized to the current name; the transparent select on top takes the taps. -->
        <label class="category" title={locked ? categoryName : 'Move to category'}>
          <span class="current">{categoryName}</span>
          {#if !sessionState.readOnly}<Icon name="chevronDown" size={14} />{/if}
          <select
            aria-label="Category"
            value={sessionState.note.folderId}
            disabled={locked || loading}
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
        <div
          class="status"
          class:error={sessionState.status === 'error' || opening === 'failed'}
          role="status"
        >
          <!-- The word count shows only when all of it fits (see .text). -->
          <span class="text">
            <span>{renaming ? 'Renaming…' : label}</span>
            {#if words !== null && !loading}
              <span class="words">· {words.toLocaleString()} {words === 1 ? 'word' : 'words'}</span>
            {/if}
          </span>
          {#if sessionState.status === 'error'}
            <button class="retry" onclick={onRetry}>Retry</button>
          {/if}
        </div>
      </div>
    </div>
    <span class="actions" class:loading inert={loading}>
      {#if boardView && onToggleBoard}
        <IconButton
          icon={boardView === 'board' ? 'text' : 'board'}
          label={boardView === 'board' ? 'Open as text' : 'Open as board'}
          onclick={onToggleBoard}
        />
      {/if}
      {#if hasOutline && !narrow}
        <span class="outline" bind:this={outlineButton}>
          <IconButton
            icon="outline"
            label="Outline"
            title="Outline: jump to a heading"
            onclick={() => (outlineItems ? (outlineItems = null) : openOutline())}
          />
        </span>
      {/if}
      {#if !sessionState.readOnly && onTags}
        <IconButton icon="tag" label="Tags" title="Saved tags and their colors" onclick={onTags} />
      {/if}
      <span class="wide">
        <IconButton icon="download" label="Export as .md" onclick={onExport} />
      </span>
      {#if !sessionState.readOnly}
        <IconButton
          icon="pin"
          label={pinned ? 'Unpin note' : 'Pin note'}
          pressed={pinned}
          onclick={onTogglePin}
        />
        <span class="wide">
          <IconButton icon="trash" label="Delete note" title="Move to trash" onclick={onDelete} />
        </span>
      {:else}
        <!-- Read-only: Export is the only one, so it stays in the header. -->
        <span class="narrow">
          <IconButton icon="download" label="Export as .md" onclick={onExport} />
        </span>
      {/if}
      {#if moreItems.length > 0}
        <span class="more" bind:this={moreButton}>
          <IconButton
            icon="more"
            label="More"
            onclick={() => {
              outlineItems = null;
              moreOpen = !moreOpen;
            }}
          />
        </span>
      {/if}
    </span>
  </div>
</div>
{#if moreOpen && moreItems.length > 0}
  <!-- Outside the header, which cuts off whatever sticks out of it. -->
  <div class="more-menu">
    <Menu
      items={moreItems}
      label="More"
      anchor={moreButton}
      onSelect={(item) => {
        moreOpen = false;
        item.run();
      }}
      onClose={() => (moreOpen = false)}
    >
      {#snippet item(it)}
        <span class="more-item"><Icon name={it.icon} />{it.label}</span>
      {/snippet}
    </Menu>
  </div>
{/if}
{#if outlineItems}
  <div class="more-menu">
    <Menu
      items={outlineItems}
      label="Outline"
      anchor={narrow ? moreButton : outlineButton}
      current={outlineCurrent}
      focusOnOpen
      onSelect={(heading) => {
        outlineItems = null;
        onJump?.(heading);
      }}
      onClose={() => (outlineItems = null)}
    >
      {#snippet item(h)}
        <span
          class="heading"
          class:top={h.level === topLevel}
          style:padding-left="{(h.level - topLevel) * 16}px"
          title={h.text}>{h.text}</span
        >
      {/snippet}
    </Menu>
  </div>
{/if}
{#if sessionState.status === 'error' && sessionState.error}
  <p class="detail" role="alert">{sessionState.error} Your text is still here.</p>
{/if}

<style>
  .wide {
    display: inline-flex;
  }

  /* Phones have Export and Delete in the "more" menu instead. */
  .narrow {
    display: none;
  }

  .more,
  .outline {
    display: inline-flex;
  }

  /* An outline row: one line, cut off with an ellipsis (the whole heading in the tooltip). */
  .heading {
    flex: 1;
    min-width: 0;
    max-width: 22em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .heading.top {
    font-weight: 600;
  }

  .more-menu {
    position: relative;
    margin-right: 6px;
  }

  @media (max-width: 599px) {
    .wide {
      display: none;
    }

    .narrow {
      display: inline-flex;
    }
  }

  .more-item {
    display: inline-flex;
    align-items: center;
    gap: 12px;
  }

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
    min-height: 56px;
    /* Across the whole width (the format bar below stays centered on the text). */
    padding: 6px 6px 0 30px;
  }

  .back {
    display: none;
    margin-left: -10px;
  }

  /* Wider screens only (phones show one pane at a time and use Back). */
  .sidebar {
    display: inline-flex;
    margin-left: -12px;
  }

  @media (max-width: 899px) {
    .inner {
      padding-left: 16px;
    }

    .back {
      display: inline-flex;
    }

    .sidebar {
      display: none;
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

  /*
   * The save status and the word count. The count shows only when all of it
   * fits: the row wraps and its second line is cut off, so the status keeps
   * the room.
   */
  .status > .text {
    display: flex;
    flex-wrap: wrap;
    column-gap: 4px;
    max-height: 1.5em;
    line-height: 1.5;
  }

  .text > span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .text > .words {
    flex: none;
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
    transition: opacity 120ms;
  }

  .actions.loading {
    opacity: 0.4;
  }

  .detail {
    margin: 0;
    padding: 8px 16px;
    background: var(--warning-bg);
    font-size: 0.875rem;
  }
</style>
