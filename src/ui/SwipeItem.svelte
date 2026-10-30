<!--
  A list row you can swipe on touch screens, like Apple Notes:
  - left to right pins (or unpins) when released past the threshold;
  - right to left opens a Delete button that stays until it is tapped, the
    row is swiped or tapped closed, or another place is tapped. Nothing is
    deleted by the swipe alone.
  Mouse input is left alone; it uses the hover and header buttons.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  interface Props {
    pinned: boolean;
    disabled?: boolean;
    onPin: () => void;
    onDelete: () => void;
    children: Snippet;
  }

  let { pinned, disabled = false, onPin, onDelete, children }: Props = $props();

  /** How far to swipe right before releasing pins. */
  const THRESHOLD = 80;
  /** Width of the Delete button a left swipe opens. */
  const REVEAL = 96;

  let row = $state<HTMLDivElement>();
  let offset = $state(0);
  let dragging = $state(false);
  let leaving = $state(false);
  let open = $state(false);

  let start: { x: number; y: number; id: number; offset: number } | null = null;
  let swiping = false;
  let swallowClick = false;

  const armed = $derived(offset >= THRESHOLD);

  function close() {
    open = false;
    offset = 0;
  }

  function onPointerDown(event: PointerEvent) {
    if (disabled || event.pointerType === 'mouse' || leaving) return;
    start = { x: event.clientX, y: event.clientY, id: event.pointerId, offset };
    swiping = false;
  }

  function onPointerMove(event: PointerEvent) {
    if (!start || event.pointerId !== start.id) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!swiping) {
      if (Math.abs(dx) < 10) return;
      // Mostly vertical: it's a scroll, not a swipe.
      if (Math.abs(dy) > Math.abs(dx)) {
        start = null;
        return;
      }
      swiping = true;
      dragging = true;
      row?.setPointerCapture(event.pointerId);
    }
    let next = start.offset + dx;
    // An open row only swipes closed, not on to pinning.
    if (start.offset < 0) next = Math.min(0, next);
    // Past the usual distance, it keeps following but more slowly.
    const limit = next > 0 ? THRESHOLD * 1.5 : REVEAL;
    const beyond = Math.max(0, Math.abs(next) - limit);
    offset = Math.sign(next) * (Math.min(Math.abs(next), limit) + beyond * 0.3);
  }

  function onPointerUp(event: PointerEvent) {
    if (!start || event.pointerId !== start.id) return;
    start = null;
    dragging = false;
    if (!swiping) {
      // A tap on an open row closes it instead of opening the note.
      if (open) {
        swallowClick = true;
        close();
      }
      return;
    }
    swiping = false;
    swallowClick = true; // The release must not also open the note.
    if (offset >= THRESHOLD) {
      close();
      onPin();
    } else if (offset <= -REVEAL / 2) {
      open = true;
      offset = -REVEAL;
    } else {
      close();
    }
  }

  function onPointerCancel() {
    start = null;
    swiping = false;
    dragging = false;
    if (!leaving) offset = open ? -REVEAL : 0;
  }

  function onClickCapture(event: MouseEvent) {
    if (!swallowClick) return;
    swallowClick = false;
    event.preventDefault();
    event.stopPropagation();
  }

  /** Tapping anywhere else closes the open Delete button. */
  function onWindowPointerDown(event: PointerEvent) {
    if (open && !row?.contains(event.target as Node)) close();
  }

  function remove() {
    leaving = true;
    offset = -(row?.offsetWidth ?? 400);
    setTimeout(onDelete, 180); // Let it slide out first.
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<!-- The swipe is an extra for touch; the row's button and the header's Pin/Delete
     buttons stay the accessible way to do the same. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={row}
  class="swipe"
  class:leaving
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerCancel}
  onclickcapture={onClickCapture}
>
  {#if offset > 0}
    <div class="action pin" class:armed aria-hidden="true">
      <span class="glyph"><Icon name="pin" /></span>
      <span>{pinned ? 'Unpin' : 'Pin'}</span>
    </div>
  {:else if offset < 0}
    <button
      class="action delete"
      style:width={`${Math.max(REVEAL, -offset)}px`}
      tabindex={open ? 0 : -1}
      aria-hidden={!open}
      onclick={remove}
    >
      <Icon name="trash" />
      <span>Delete</span>
    </button>
  {/if}
  <div class="content" class:dragging style:transform={offset ? `translateX(${offset}px)` : ''}>
    {@render children()}
  </div>
</div>

<style>
  .swipe {
    position: relative;
    overflow: hidden;
    border-radius: 8px;
    /* Vertical scrolling stays native; horizontal moves come to us. */
    touch-action: pan-y;
  }

  .swipe.leaving {
    pointer-events: none;
  }

  .content {
    position: relative;
    background: var(--bg);
    transition: transform 180ms ease;
  }

  .content.dragging {
    transition: none;
  }

  .action {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 20px;
    color: #fff;
    font-weight: 600;
    font-size: 0.875rem;
  }

  .action.delete {
    left: auto;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    padding: 0;
    border: 0;
    background: var(--danger-strong);
    font: inherit;
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
  }

  .action.pin {
    justify-content: flex-start;
    background: var(--pin);
  }

  .glyph {
    display: inline-flex;
    transition: transform 120ms ease;
  }

  .action.armed .glyph {
    transform: scale(1.25);
  }
</style>
