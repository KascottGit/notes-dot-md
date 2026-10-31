<!--
  Board view (SPEC "Board view"): the note's markdown shown as columns of
  cards. The file stays one markdown string; every edit, drag or rename
  changes only its own lines and goes out through onEdit.
  Desktop: columns side by side like Trello. Phones: columns stacked.
-->
<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import type { StateCommand } from '@codemirror/state';
  import {
    addCard,
    addColumn,
    archiveCard,
    boardTags,
    deleteColumn,
    doneColumnIndex,
    hasTag,
    isReservedTitle,
    moveCard,
    moveColumn,
    parseBoard,
    renameCard,
    renameColumn,
    replaceBody,
    setDueDate,
    visibleColumns,
    type Board,
    type CardRef,
    type Span,
  } from '../editor/board';
  import type { Editor } from '../editor/setup';
  import BoardCard from './BoardCard.svelte';
  import CardBody from './CardBody.svelte';
  import Chip from './Chip.svelte';
  import ChipRow from './ChipRow.svelte';
  import Icon from './Icon.svelte';
  import IconButton from './IconButton.svelte';
  import InlineName from './InlineName.svelte';

  interface Props {
    text: string;
    readOnly: boolean;
    /** The new text of the whole file. */
    onEdit: (text: string) => void;
    onSave: () => void;
    onToast: (message: string, undo?: () => void) => void;
  }

  let { text, readOnly, onEdit, onSave, onToast }: Props = $props();

  const board = $derived(parseBoard(text));
  const columns = $derived(visibleColumns(board));
  const doneIndex = $derived(doneColumnIndex(board));

  // ---------------------------------------------------------- Tag filter

  /** Show only cards with this tag (without `#`); null shows all. */
  let tagFilter = $state<string | null>(null);
  const tags = $derived.by(() => {
    const found = boardTags(board);
    // Keep the chosen tag in the row (at 0) until it is cleared, so it can be.
    if (tagFilter && !found.some((t) => t.tag.toLowerCase() === tagFilter!.toLowerCase())) {
      found.unshift({ tag: tagFilter, count: 0 });
    }
    return found;
  });
  const shown = (card: Board['columns'][number]['cards'][number]) =>
    !tagFilter || hasTag(card, tagFilter);

  /** Which text an editor edits: the board intro, a column intro or a card body. */
  type Part =
    { kind: 'intro' } | { kind: 'columnIntro'; column: number } | ({ kind: 'card' } & CardRef);

  function spanOf(b: Board, part: Part): Span | null {
    if (part.kind === 'intro') return b.intro;
    const column = b.columns[part.column];
    if (part.kind === 'columnIntro') return column?.intro ?? null;
    return column?.cards[part.card]?.body ?? null;
  }

  const slice = (span: Span) => text.slice(span.from, span.to);

  function editPart(part: Part, body: string) {
    const span = spanOf(board, part);
    if (span) onEdit(replaceBody(text, span, body));
  }

  // ---------------------------------------------------------- Focus and toolbar

  let active: { editor: Editor; part: Part } | null = null;
  /** A new card whose title gets the cursor. */
  let newCardKey = $state<string | null>(null);
  const key = (ref: CardRef) => `${ref.column}:${ref.card}`;

  /** Run a format bar command in the card that has (or last had) the cursor. */
  export function run(command: StateCommand) {
    active?.editor.run(command);
  }

  let dateInput = $state<HTMLInputElement>();

  /** The format bar's due date button: open the date picker for the current card. */
  export function pickDueDate() {
    const part = active?.part;
    if (!part || part.kind !== 'card' || !dateInput) {
      onToast('Put the cursor in a card first.');
      return;
    }
    dateInput.value = board.columns[part.column]?.cards[part.card]?.meta.due ?? '';
    try {
      dateInput.showPicker();
    } catch {
      dateInput.focus();
    }
  }

  function onDatePicked() {
    const part = active?.part;
    if (!part || part.kind !== 'card' || !dateInput) return;
    const span = spanOf(board, part);
    if (!span) return;
    editPart(part, setDueDate(slice(span), dateInput.value || null));
    onSave();
  }

  function focused(editor: Editor, part: Part) {
    active = { editor, part };
  }

  function destroyed(editor: Editor) {
    if (active?.editor === editor) active = null;
  }

  // ---------------------------------------------------------- Card actions

  async function newCard(column: number) {
    const added = addCard(text, column);
    let next = added.text;
    // While filtering, a new card gets the tag, or it would be hidden right away.
    const card = parseBoard(next).columns[column]?.cards[added.card.card];
    if (tagFilter && card) next = replaceBody(next, card.body, `#${tagFilter}`);
    onEdit(next);
    await tick();
    newCardKey = key(added.card);
  }

  // ---------------------------------------------------------- Column actions

  let columnNames = $state<Record<number, InlineName | undefined>>({});
  /** The column whose title is being edited. */
  let editingColumn = $state<number | null>(null);

  /** Focus right away, inside the tap, so phones open the keyboard. */
  function editColumnTitle(column: number) {
    if (readOnly) return;
    editingColumn = column;
    columnNames[column]?.focus();
  }

  async function newColumn() {
    const added = addColumn(text);
    onEdit(added.text);
    onSave();
    await tick();
    editColumnTitle(added.column);
  }

  async function renameCol(column: number, title: string) {
    if (isReservedTitle(title)) {
      onToast('"Archive" is kept for deleted cards. Pick another name.');
      return;
    }
    onEdit(renameColumn(text, column, title));
    onSave();
  }

  function removeColumn(column: number) {
    const col = board.columns[column];
    if (!col) return;
    const n = col.cards.length;
    if (
      n > 0 &&
      !confirm(
        `Delete the column "${col.title}"? Its ${n} card${n === 1 ? '' : 's'} move to Archive.`,
      )
    ) {
      return;
    }
    const before = text;
    const after = deleteColumn(text, column);
    if (after === before) return;
    onEdit(after);
    onSave();
    onToast(`Column "${col.title}" deleted`, () => {
      if (text === after) onEdit(before);
      else onToast('The board changed since. Its cards are in the Archive column (open as text).');
    });
  }

  async function rename(ref: CardRef, title: string) {
    onEdit(renameCard(text, ref, title));
    onSave();
  }

  function remove(ref: CardRef) {
    const before = text;
    const after = archiveCard(text, ref);
    if (after === before) return;
    onEdit(after);
    onSave();
    onToast('Card moved to Archive', () => {
      if (text === after) onEdit(before);
      else onToast('The board changed since. The card is in the Archive column (open as text).');
    });
  }

  // ---------------------------------------------------------- Drag and drop

  type Item = { kind: 'card'; ref: CardRef } | { kind: 'column'; column: number };

  let root = $state<HTMLDivElement>();
  let press: {
    item: Item;
    el: HTMLElement;
    pointerId: number;
    x: number;
    y: number;
    touch: boolean;
    timer: ReturnType<typeof setTimeout> | null;
    onTap?: () => void;
  } | null = null;
  let drag: {
    item: Item;
    el: HTMLElement;
    ghost: HTMLElement;
    dx: number;
    dy: number;
    x: number;
    y: number;
    frame: number;
  } | null = null;
  /** Card: column (index in board.columns) and position among its other cards. Column: position among the others. */
  let drop: { column: number; index: number } | null = null;
  /** What is being dragged, so it can be dimmed in place. */
  let dragging = $state<Item | null>(null);
  let indicator = $state<{ left: number; top: number; width: number; height: number } | null>(null);

  const HOLD_MS = 300;
  const SLOP = 8;

  function startPress(event: PointerEvent, item: Item, el: HTMLElement, onTap?: () => void) {
    if (readOnly || event.button !== 0 || press || drag) return;
    const touch = event.pointerType !== 'mouse';
    if (!touch) event.preventDefault(); // No text selection while dragging.
    press = {
      item,
      el,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      touch,
      timer: null,
      onTap,
    };
    if (touch) press.timer = setTimeout(() => press && beginDrag(press.x, press.y), HOLD_MS);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('touchmove', blockScroll, { passive: false });
    window.addEventListener('keydown', onKeydown);
  }

  function onPointerMove(event: PointerEvent) {
    if (drag) {
      drag.x = event.clientX;
      drag.y = event.clientY;
      drag.ghost.style.transform = `translate(${drag.x - drag.dx}px, ${drag.y - drag.dy}px)`;
      updateDrop();
      return;
    }
    if (!press || event.pointerId !== press.pointerId) return;
    const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y);
    if (press.touch) {
      if (moved > SLOP) cancel(); // A scroll, not a hold.
    } else if (moved > 5) {
      beginDrag(press.x, press.y);
      onPointerMove(event);
    }
  }

  function onPointerUp(event: PointerEvent) {
    if (drag) {
      finishDrag();
      return;
    }
    const tap = press && event.pointerId === press.pointerId ? press.onTap : undefined;
    cancel();
    tap?.();
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') cancel();
  }

  /** Once a drag runs, the page must not scroll under the finger. */
  function blockScroll(event: TouchEvent) {
    if (drag && event.cancelable) event.preventDefault();
  }

  function beginDrag(x: number, y: number) {
    if (!press || !root) return;
    const { item, el } = press;
    if (press.timer) clearTimeout(press.timer);
    press = null;
    const rect = el.getBoundingClientRect();
    const ghost = el.cloneNode(true) as HTMLElement;
    ghost.classList.add('ghost');
    ghost.removeAttribute('data-card');
    ghost.removeAttribute('data-column');
    Object.assign(ghost.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      width: `${rect.width}px`,
      height: item.kind === 'column' ? `${Math.min(rect.height, 320)}px` : `${rect.height}px`,
      overflow: 'hidden',
      margin: '0',
      zIndex: '1000',
      pointerEvents: 'none',
      transform: `translate(${rect.left}px, ${rect.top}px)`,
    });
    document.body.appendChild(ghost);
    dragging = item;
    drag = { item, el, ghost, dx: x - rect.left, dy: y - rect.top, x, y, frame: 0 };
    document.getSelection()?.removeAllRanges();
    navigator.vibrate?.(10);
    updateDrop();
    drag.frame = requestAnimationFrame(autoScroll);
  }

  function columnEls(): HTMLElement[] {
    return root ? [...root.querySelectorAll<HTMLElement>('[data-column]')] : [];
  }

  /** The element a point is over, or else the nearest one. */
  function nearest(els: HTMLElement[], x: number, y: number): HTMLElement | null {
    let best: HTMLElement | null = null;
    let bestDistance = Infinity;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      const d = Math.hypot(dx, dy);
      if (d < bestDistance) [best, bestDistance] = [el, d];
    }
    return best;
  }

  function updateDrop() {
    if (!drag || !root) return;
    const { x, y, item } = drag;
    const cols = columnEls();
    if (item.kind === 'card') {
      const colEl = nearest(cols, x, y);
      if (!colEl) return;
      const column = Number(colEl.dataset.column);
      const cards = [...colEl.querySelectorAll<HTMLElement>('[data-card]')].filter(
        (c) => c !== drag!.el,
      );
      let index = cards.findIndex((c) => {
        const r = c.getBoundingClientRect();
        return y < r.top + r.height / 2;
      });
      if (index === -1) index = cards.length;
      // The shown cards may skip filtered-out ones: turn the place on screen into
      // a place among the column's other cards in the file.
      const at = (el: HTMLElement) => Number(el.dataset.card);
      let place =
        index < cards.length
          ? at(cards[index]!)
          : cards.length > 0
            ? at(cards.at(-1)!) + 1
            : (board.columns[column]?.cards.length ?? 0);
      const from = item.ref;
      if (from.column === column && place > from.card) place--;
      drop = { column, index: place };
      const list = colEl.querySelector<HTMLElement>('[data-cards]')!.getBoundingClientRect();
      const top =
        index < cards.length
          ? cards[index]!.getBoundingClientRect().top - 5
          : cards.length > 0
            ? cards.at(-1)!.getBoundingClientRect().bottom + 3
            : list.top + 4;
      indicator = { left: list.left + 8, top, width: list.width - 16, height: 2 };
    } else {
      // Side by side on desktop; stacked on phones.
      const stacked = !desktop();
      const others = cols.filter((c) => c !== drag!.el);
      let index = others.findIndex((c) => {
        const r = c.getBoundingClientRect();
        return stacked ? y < r.top + r.height / 2 : x < r.left + r.width / 2;
      });
      if (index === -1) index = others.length;
      drop = { column: -1, index };
      const r = (others[index] ?? others.at(-1))?.getBoundingClientRect();
      if (!r) return;
      if (stacked) {
        const top = index < others.length ? r.top - 9 : r.bottom + 7;
        indicator = { left: r.left, top, width: r.width, height: 2 };
      } else {
        const left = index < others.length ? r.left - 7 : r.right + 5;
        indicator = { left, top: r.top, width: 2, height: Math.max(r.height, 80) };
      }
    }
  }

  /** Scroll the board (and on desktop the column under the pointer) near its edges. */
  function autoScroll() {
    if (!drag || !root) return;
    const { x, y } = drag;
    const scrollers = [...root.querySelectorAll<HTMLElement>('[data-scroll]')];
    let scrolled = false;
    for (const el of scrollers) {
      const r = el.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top - 40 || y > r.bottom + 40) continue;
      const step = (distance: number) => Math.ceil(((56 - distance) / 56) * 16);
      if (el.scrollWidth > el.clientWidth) {
        if (x - r.left < 56) el.scrollLeft -= step(x - r.left);
        else if (r.right - x < 56) el.scrollLeft += step(r.right - x);
        else continue;
        scrolled = true;
      }
      if (el.scrollHeight > el.clientHeight) {
        if (y - r.top < 56) el.scrollTop -= step(Math.max(0, y - r.top));
        else if (r.bottom - y < 56) el.scrollTop += step(Math.max(0, r.bottom - y));
        else continue;
        scrolled = true;
      }
    }
    if (scrolled) updateDrop();
    drag.frame = requestAnimationFrame(autoScroll);
  }

  function finishDrag() {
    const done = drag;
    const target = drop;
    cancel();
    if (!done || !target) return;
    let next: string;
    if (done.item.kind === 'card') {
      next = moveCard(text, done.item.ref, { column: target.column, card: target.index });
    } else {
      // Position among the other columns (Archive included), from the shown ones.
      const from = done.item.column;
      const shown = columns.map((c) => c.index).filter((i) => i !== from);
      if (shown.length === 0) return;
      const after = (i: number) => (i > from ? i - 1 : i);
      const to =
        target.index < shown.length ? after(shown[target.index]!) : after(shown.at(-1) ?? 0) + 1;
      next = moveColumn(text, from, to);
    }
    if (next !== text) {
      onEdit(next);
      onSave();
    }
  }

  function cancel() {
    if (press?.timer) clearTimeout(press.timer);
    press = null;
    if (drag) {
      cancelAnimationFrame(drag.frame);
      drag.ghost.remove();
      drag = null;
    }
    dragging = null;
    drop = null;
    indicator = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('touchmove', blockScroll);
    window.removeEventListener('keydown', onKeydown);
  }

  onDestroy(cancel);

  const desktop = () => window.matchMedia('(min-width: 900px)').matches;
</script>

<div class="board" bind:this={root} data-scroll>
  {#if tags.length > 0}
    <div class="filter">
      <ChipRow label="Filter cards by tag" scroll>
        <Chip label="All cards" active={tagFilter === null} onclick={() => (tagFilter = null)} />
        {#each tags as t (t.tag.toLowerCase())}
          {@const active = tagFilter?.toLowerCase() === t.tag.toLowerCase()}
          <Chip
            label={`#${t.tag}`}
            count={t.count}
            {active}
            title={active ? 'Show all cards' : `Only cards with #${t.tag}`}
            onclick={() => (tagFilter = active ? null : t.tag)}
          />
        {/each}
      </ChipRow>
    </div>
  {/if}
  {#if board.intro.to > board.intro.from}
    <div class="intro">
      <CardBody
        text={slice(board.intro)}
        {readOnly}
        onChange={(t) => editPart({ kind: 'intro' }, t)}
        onFocus={(e) => focused(e, { kind: 'intro' })}
        onDestroyed={destroyed}
        {onSave}
      />
    </div>
  {/if}

  <div class="columns" data-scroll>
    {#each columns as { column, index: ci } (`${ci}:${column.title}`)}
      {@const count = column.cards.filter(shown).length}
      <section
        class="column"
        class:dragging={dragging?.kind === 'column' && dragging.column === ci}
        data-column={ci}
        aria-label={column.title}
      >
        <!-- Tap the title to rename; press and hold (or drag with a mouse) to move the column. -->
        <header
          class="column-head"
          class:movable={!readOnly}
          class:editing={editingColumn === ci}
          role="presentation"
          onpointerdown={(e) => {
            const el = e.currentTarget.parentElement;
            if (editingColumn === ci || !el || (e.target as Element).closest('button')) return;
            startPress(e, { kind: 'column', column: ci }, el, () => editColumnTitle(ci));
          }}
          onmousedown={(e) => {
            // After a tap, the browser's own mousedown must not take focus away from the title.
            if (!(e.target as Element).closest('input, button')) e.preventDefault();
          }}
        >
          <div
            class="column-title"
            onfocusin={() => (editingColumn = ci)}
            onfocusout={() => (editingColumn = null)}
          >
            <InlineName
              bind:this={columnNames[ci]}
              value={column.title}
              label="Column title"
              readonly={readOnly}
              onCommit={(title) => renameCol(ci, title)}
            />
          </div>
          <span
            class="count"
            title={tagFilter ? `${count} of ${column.cards.length} cards shown` : undefined}
            >{count}</span
          >
          {#if !readOnly}
            <span class="column-delete">
              <IconButton
                icon="trash"
                label={`Delete column ${column.title}`}
                title="Delete column"
                onclick={() => removeColumn(ci)}
              />
            </span>
          {/if}
        </header>
        <div class="cards" data-cards data-scroll>
          {#if column.intro.to > column.intro.from}
            <div class="column-intro">
              <CardBody
                text={slice(column.intro)}
                {readOnly}
                onChange={(t) => editPart({ kind: 'columnIntro', column: ci }, t)}
                onFocus={(e) => focused(e, { kind: 'columnIntro', column: ci })}
                onDestroyed={destroyed}
                {onSave}
              />
            </div>
          {/if}
          {#each column.cards as card, i (`${i}:${card.title}`)}
            {@const ref = { column: ci, card: i }}
            {#if shown(card)}
              <BoardCard
                {card}
                index={i}
                body={slice(card.body)}
                {readOnly}
                done={ci === doneIndex}
                dragging={dragging?.kind === 'card' &&
                  dragging.ref.column === ci &&
                  dragging.ref.card === i}
                focusTitle={newCardKey === key(ref)}
                onBody={(t) => editPart({ kind: 'card', ...ref }, t)}
                onRename={(title) => rename(ref, title)}
                onTitleDone={() => {
                  if (newCardKey === key(ref)) newCardKey = null;
                }}
                onDelete={() => remove(ref)}
                onPress={(e, el, onTap) => startPress(e, { kind: 'card', ref }, el, onTap)}
                onFocus={(e) => focused(e, { kind: 'card', ...ref })}
                onDestroyed={destroyed}
                {onSave}
              />
            {/if}
          {/each}
        </div>
        {#if !readOnly}
          <button class="add" onclick={() => void newCard(ci)}>
            <Icon name="plus" size={18} />
            Add card
          </button>
        {/if}
      </section>
    {/each}
    {#if !readOnly}
      <button class="add-column" onclick={() => void newColumn()}>
        <Icon name="plus" size={18} />
        Add column
      </button>
    {:else if columns.length === 0}
      <p class="empty">No columns yet.</p>
    {/if}
  </div>

  {#if indicator}
    <div
      class="drop"
      style:left="{indicator.left}px"
      style:top="{indicator.top}px"
      style:width="{indicator.width}px"
      style:height="{indicator.height}px"
    ></div>
  {/if}
  <input
    bind:this={dateInput}
    class="date"
    type="date"
    tabindex="-1"
    aria-label="Due date"
    onchange={onDatePicked}
  />
</div>

<style>
  .board {
    position: relative;
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
  }

  .intro {
    max-height: 30vh;
    overflow-y: auto;
    padding: 8px 16px 0 28px;
  }

  .columns {
    display: flex;
    flex: 1;
    align-items: flex-start;
    gap: 12px;
    min-height: 0;
    padding: 12px 16px 16px;
    overflow-x: auto;
    overflow-y: hidden;
  }

  .column {
    display: flex;
    flex: none;
    flex-direction: column;
    width: 288px;
    min-width: 0;
    max-height: 100%;
    border-radius: 12px;
    background: var(--bg-muted);
    transition: opacity 120ms ease;
  }

  .column.dragging {
    opacity: 0.35;
  }

  .column-head {
    display: flex;
    flex: none;
    align-items: center;
    gap: 4px;
    min-height: 44px;
    padding: 2px 4px 0 14px;
  }

  .column-head.movable {
    cursor: grab;
    user-select: none;
  }

  .column-head {
    /* Press and hold to drag on touch screens: no text selection or callout. */
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }

  .column-head.editing {
    cursor: auto;
  }

  .column-title {
    flex: 1;
    min-width: 0;
  }

  .column-title :global(.inline-name) {
    font-size: 0.9375rem;
    font-weight: 650;
  }

  /* Until tapped, the title is part of the drag handle. */
  .column-head:not(.editing) .column-title :global(.inline-name) {
    cursor: inherit;
    pointer-events: none;
  }

  /* With a mouse, delete opens up on hover (as on cards); touch screens always show it. */
  @media (hover: hover) and (pointer: fine) {
    .column-delete {
      width: 0;
      overflow: hidden;
      opacity: 0;
      transition:
        width 120ms ease,
        opacity 120ms ease;
    }

    .column-head:hover .column-delete,
    .column-delete:focus-within {
      width: 44px;
      opacity: 1;
    }
  }

  .filter {
    flex: none;
    padding: 10px 8px 0;
  }

  .add-column {
    display: flex;
    flex: none;
    align-items: center;
    gap: 6px;
    width: 288px;
    min-height: 44px;
    padding: 0 14px;
    border: 0;
    border-radius: 12px;
    background: none;
    color: var(--text-muted);
    font: inherit;
    font-size: 0.9375rem;
    cursor: pointer;
    transition:
      background-color 120ms ease,
      color 120ms ease;
  }

  .add-column:hover {
    background: var(--bg-muted);
    color: var(--text);
  }

  .count {
    flex: none;
    color: var(--text-muted);
    font-size: 0.8125rem;
    font-variant-numeric: tabular-nums;
  }

  .cards {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 12px;
    padding: 0 8px;
    overflow-y: auto;
  }

  .column-intro {
    padding: 0 6px;
    color: var(--text-muted);
  }

  .add {
    display: flex;
    flex: none;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    margin: 4px 8px 8px;
    padding: 0 8px;
    border: 0;
    border-radius: 8px;
    background: none;
    color: var(--text-muted);
    font: inherit;
    font-size: 0.9375rem;
    cursor: pointer;
    transition:
      background-color 120ms ease,
      color 120ms ease;
  }

  .add:hover {
    background: var(--border);
    color: var(--text);
  }

  .empty {
    margin: auto;
    color: var(--text-muted);
  }

  .drop {
    position: fixed;
    z-index: 1001;
    border-radius: 2px;
    background: var(--accent);
    pointer-events: none;
  }

  :global(.ghost) {
    border-radius: 10px;
    box-shadow: 0 10px 30px rgb(0 0 0 / 22%);
    opacity: 0.95;
  }

  .date {
    position: absolute;
    top: 0;
    right: 0;
    width: 1px;
    height: 1px;
    border: 0;
    opacity: 0;
    pointer-events: none;
  }

  /* Phones: columns stacked, the whole board scrolls as one list. */
  @media (max-width: 899px) {
    .board {
      overflow-y: auto;
    }

    .intro {
      max-height: none;
      overflow: visible;
      padding: 8px 16px 0 28px;
    }

    .columns {
      flex: none;
      flex-direction: column;
      align-items: stretch;
      gap: 16px;
      overflow: visible;
    }

    .column {
      width: auto;
      max-height: none;
    }

    .add-column {
      width: auto;
    }

    .cards {
      overflow: visible;
    }
  }
</style>
