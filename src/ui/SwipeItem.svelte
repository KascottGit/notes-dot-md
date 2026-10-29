<!--
  A list row you can swipe on touch screens, like Apple Notes:
  left to right pins (or unpins), right to left deletes, when released past
  the threshold. Mouse input is left alone; it uses the buttons in the header.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    pinned: boolean;
    disabled?: boolean;
    onPin: () => void;
    onDelete: () => void;
    children: Snippet;
  }

  let { pinned, disabled = false, onPin, onDelete, children }: Props = $props();

  /** How far to swipe before releasing does something. */
  const THRESHOLD = 80;

  let row = $state<HTMLDivElement>();
  let offset = $state(0);
  let dragging = $state(false);
  let leaving = $state(false);

  let start: { x: number; y: number; id: number } | null = null;
  let swiping = false;
  let swallowClick = false;

  const armed = $derived(Math.abs(offset) >= THRESHOLD);

  function onPointerDown(event: PointerEvent) {
    if (disabled || event.pointerType === 'mouse' || leaving) return;
    start = { x: event.clientX, y: event.clientY, id: event.pointerId };
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
    // Past the threshold, it keeps following but more slowly.
    const beyond = Math.max(0, Math.abs(dx) - THRESHOLD * 1.5);
    offset = Math.sign(dx) * (Math.min(Math.abs(dx), THRESHOLD * 1.5) + beyond * 0.3);
  }

  function onPointerUp(event: PointerEvent) {
    if (!start || event.pointerId !== start.id) return;
    start = null;
    dragging = false;
    if (!swiping) return;
    swiping = false;
    swallowClick = true; // The release must not also open the note.
    if (offset >= THRESHOLD) {
      offset = 0;
      onPin();
    } else if (offset <= -THRESHOLD) {
      leaving = true;
      offset = -(row?.offsetWidth ?? 400);
      setTimeout(onDelete, 180); // Let it slide out first.
    } else {
      offset = 0;
    }
  }

  function onPointerCancel() {
    start = null;
    swiping = false;
    dragging = false;
    if (!leaving) offset = 0;
  }

  function onClickCapture(event: MouseEvent) {
    if (!swallowClick) return;
    swallowClick = false;
    event.preventDefault();
    event.stopPropagation();
  }
</script>

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
      <svg viewBox="0 0 24 24"><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3zM12 15v5" /></svg>
      <span>{pinned ? 'Unpin' : 'Pin'}</span>
    </div>
  {:else if offset < 0}
    <div class="action delete" class:armed aria-hidden="true">
      <span>Delete</span>
      <svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>
    </div>
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

  .action.pin {
    justify-content: flex-start;
    background: var(--pin);
  }

  .action.delete {
    justify-content: flex-end;
    background: var(--danger-strong);
  }

  .action svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: transform 120ms ease;
  }

  .action.armed svg {
    transform: scale(1.25);
  }
</style>
