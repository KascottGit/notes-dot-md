<!--
  One card on a board: the title row (drag handle, rename, progress, delete)
  and the markdown body below it.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import type { BoardCard } from '../editor/board';
  import type { Editor } from '../editor/setup';
  import CardBody from './CardBody.svelte';
  import Icon from './Icon.svelte';
  import IconButton from './IconButton.svelte';
  import InlineName from './InlineName.svelte';

  interface Props {
    card: BoardCard;
    /** Position in its column (also when some cards are filtered out). */
    index: number;
    body: string;
    readOnly: boolean;
    /** Being dragged: dimmed in place. */
    dragging: boolean;
    /** In the done column: its due date no longer shows as overdue or due today. */
    done?: boolean;
    /** Start with the title field focused (a new card). */
    focusTitle: boolean;
    onBody: (text: string) => void;
    onRename: (title: string) => Promise<void>;
    onTitleDone: () => void;
    onDelete: () => void;
    /** Open the card's image board. */
    onAttach: () => void;
    /** Pointer down on the title row: the board decides between a tap (rename) and a drag. */
    onPress: (event: PointerEvent, cardEl: HTMLElement, onTap: () => void) => void;
    onFocus: (editor: Editor) => void;
    onDestroyed: (editor: Editor) => void;
    onSave: () => void;
  }

  let {
    card,
    index,
    body,
    readOnly,
    dragging,
    done = false,
    focusTitle,
    onBody,
    onRename,
    onTitleDone,
    onDelete,
    onAttach,
    onPress,
    onFocus,
    onDestroyed,
    onSave,
  }: Props = $props();

  let el = $state<HTMLElement>();
  let name = $state<InlineName>();
  let editing = $state(false);

  /** Focus right away, inside the tap, so phones open the keyboard. */
  function editTitle() {
    if (readOnly) return;
    editing = true;
    name?.focus();
  }

  $effect(() => {
    if (focusTitle) void tick().then(editTitle);
  });
</script>

<article class="card reveal-host" class:dragging class:done bind:this={el} data-card={index}>
  <div
    class="title-row"
    class:editing
    role="presentation"
    onpointerdown={(e) => {
      if (!editing && el && !(e.target as Element).closest('button')) onPress(e, el, editTitle);
    }}
    onmousedown={(e) => {
      // After a tap, the browser's own mousedown must not take focus away from the title.
      if (!(e.target as Element).closest('input, button')) e.preventDefault();
    }}
  >
    <div
      class="title"
      onfocusin={() => (editing = true)}
      onfocusout={() => {
        editing = false;
        onTitleDone();
      }}
    >
      <InlineName
        bind:this={name}
        value={card.title}
        label="Card title"
        readonly={readOnly}
        wrap
        onCommit={onRename}
      />
    </div>
    {#if card.tasks.total > 0}
      <span
        class="progress"
        class:complete={card.tasks.done === card.tasks.total}
        title={`${card.tasks.done} of ${card.tasks.total} tasks done`}
      >
        <Icon name="task" size={16} />
        {card.tasks.done}/{card.tasks.total}
      </span>
    {/if}
    {#if !readOnly || card.attachments.length > 0}
      <!-- Always shown once the card has images (with their count), else on hover like delete. -->
      <span class="attach" class:reveal={card.attachments.length === 0}>
        <IconButton
          icon="attach"
          label={`Images on ${card.title}`}
          title={card.attachments.length > 0 ? 'Images' : 'Add images'}
          count={card.attachments.length}
          onclick={onAttach}
        />
      </span>
    {/if}
    {#if !readOnly}
      <span class="delete reveal">
        <IconButton
          icon="trash"
          label={`Delete card ${card.title}`}
          title="Delete card"
          onclick={onDelete}
        />
      </span>
    {/if}
  </div>
  <CardBody
    text={body}
    {readOnly}
    hint="Add details…"
    onChange={onBody}
    {onFocus}
    {onDestroyed}
    {onSave}
  />
</article>

<style>
  .card {
    padding: 0 0 10px 9px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg);
    transition: opacity 120ms ease;
  }

  .card.dragging {
    opacity: 0.35;
  }

  /* A long title wraps; the task count and delete stay level with its first line. */
  .title-row {
    display: flex;
    align-items: flex-start;
    gap: 2px;
    min-height: 44px;
    cursor: grab;
    /* Press and hold to drag on touch screens: no text selection or callout. */
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }

  .title-row.editing {
    cursor: auto;
  }

  .title {
    flex: 1;
    min-width: 0;
    /* Lines the title up with the body text, which starts 3px in. */
    padding: 7px 4px 7px 3px;
  }

  /* Until tapped, the title is part of the drag handle. */
  .title-row:not(.editing) .title :global(.inline-name) {
    cursor: inherit;
    pointer-events: none;
  }

  .progress {
    display: inline-flex;
    flex: none;
    align-items: center;
    height: 44px;
    gap: 4px;
    padding: 0 4px;
    color: var(--text-muted);
    font-size: 0.8125rem;
    font-variant-numeric: tabular-nums;
  }

  .progress.complete {
    color: var(--accent);
  }

  /* A finished card's date is just a date. */
  .card.done :global(.cm-board-chip) {
    background-color: var(--bg-muted);
    color: var(--text-muted);
  }

  .card :global(.cm-editor) {
    cursor: text;
  }

  /* Empty bodies say "Add details…" only on hover or with the cursor in them. */
  .card :global(.cm-editor:not(.cm-focused) .cm-placeholder) {
    visibility: hidden;
  }

  /*
   * With a mouse, delete shows on hover: it opens up at the end of the row, so
   * the task count moves aside instead of being covered. Touch screens always
   * show it.
   */
  @media (hover: hover) and (pointer: fine) {
    .card:hover :global(.cm-placeholder) {
      visibility: visible;
    }

    .progress {
      padding-right: 12px;
      transition: padding-right 120ms ease;
    }

    .card:hover .progress {
      padding-right: 2px;
    }
  }
</style>
