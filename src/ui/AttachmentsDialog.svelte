<!--
  A card's image board (SPEC "Image attachments on cards"): its images as a
  tidy grid. Add by pasting, dropping files or the add button; drag a tile to
  reorder (on touch, press and hold first). Tap a tile to see it large, with
  the trash button to remove it.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Attachment } from '../editor/board';
  import IconButton from './IconButton.svelte';
  import { imageUrl, isImageFile } from './images';

  interface Props {
    open: boolean;
    title: string;
    attachments: Attachment[];
    /** Images still uploading, shown as placeholder tiles. */
    uploading: number;
    error: string | null;
    readOnly: boolean;
    onFiles: (files: File[]) => void;
    onReorder: (attachments: Attachment[]) => void;
    /** Move an image to the Drive trash (the board offers Undo). */
    onRemove: (index: number) => void;
    onClose: () => void;
    /** Shown inside the dialog, e.g. the toast with Undo. */
    children?: Snippet;
  }

  let {
    open,
    title,
    attachments,
    uploading,
    error,
    readOnly,
    onFiles,
    onReorder,
    onRemove,
    onClose,
    children,
  }: Props = $props();

  /** The image shown large, by index. */
  let viewing = $state<number | null>(null);
  const viewed = $derived(viewing === null ? null : (attachments[viewing] ?? null));

  function step(by: number) {
    if (viewing === null || attachments.length === 0) return;
    viewing = (viewing + by + attachments.length) % attachments.length;
  }

  function remove(index: number) {
    // Counted first: the list is shorter right after onRemove.
    const left = attachments.length - 1;
    onRemove(index);
    // Show the next image (or the new last one); none left closes the view.
    viewing = left > 0 ? Math.min(index, left - 1) : null;
  }

  function onKeydown(event: KeyboardEvent) {
    if (viewing === null) return;
    if (event.key === 'ArrowRight') step(1);
    else if (event.key === 'ArrowLeft') step(-1);
  }

  let dialog = $state<HTMLDialogElement>();
  let picker = $state<HTMLInputElement>();
  let grid = $state<HTMLElement>();
  let dropping = $state(false);

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      viewing = null;
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  });

  function addFiles(list: FileList | null | undefined) {
    const files = [...(list ?? [])].filter(isImageFile);
    if (files.length && !readOnly) onFiles(files);
  }

  /** Ctrl+V anywhere in the dialog, or Paste from the iPhone menu on the paste area. */
  function onPaste(event: ClipboardEvent) {
    if (!open) return;
    event.preventDefault();
    addFiles(event.clipboardData?.files);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    dropping = false;
    addFiles(event.dataTransfer?.files);
  }

  // ------------------------------------------------------------ Reorder

  const HOLD_MS = 300;
  const SLOP = 8;
  let press: { index: number; x: number; y: number; touch: boolean; timer: number } | null = null;
  let drag = $state<{ index: number; dx: number; dy: number; size: number } | null>(null);
  /** Where the dragged image is drawn, following the pointer. */
  let ghost = $state<{ x: number; y: number } | null>(null);
  /** Where the dragged image would go. */
  let target = $state<number | null>(null);
  let dragged = $state<number | null>(null);

  /** A tap opens the image large; a drag (or press and hold on touch) moves it. */
  function onTileDown(event: PointerEvent, index: number) {
    if (event.button !== 0 || press || drag) return;
    if ((event.target as Element).closest('button')) return; // The tile's trash button.
    const touch = event.pointerType !== 'mouse';
    if (!touch) event.preventDefault();
    press = { index, x: event.clientX, y: event.clientY, touch, timer: 0 };
    if (touch && !readOnly) {
      press.timer = window.setTimeout(() => press && beginDrag(press.x, press.y), HOLD_MS);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('touchmove', blockScroll, { passive: false });
  }

  function onMove(event: PointerEvent) {
    if (drag) {
      ghost = { x: event.clientX - drag.dx, y: event.clientY - drag.dy };
      target = nearestTile(event.clientX, event.clientY);
      return;
    }
    if (!press) return;
    const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y);
    if (press.touch ? moved > SLOP : false)
      stop(); // A scroll, not a hold or a tap.
    else if (!press.touch && moved > 5) {
      if (readOnly) {
        stop();
        return;
      }
      beginDrag(press.x, press.y);
      onMove(event);
    }
  }

  function beginDrag(x: number, y: number) {
    if (!press || !grid) return;
    const tile = grid.querySelector<HTMLElement>(`[data-index="${press.index}"]`);
    clearTimeout(press.timer);
    const index = press.index;
    press = null;
    if (!tile) return;
    const rect = tile.getBoundingClientRect();
    drag = { index, dx: x - rect.left, dy: y - rect.top, size: rect.width };
    ghost = { x: rect.left, y: rect.top };
    dragged = index;
    target = index;
  }

  /** The tile nearest to a point: where a dropped image goes. */
  function nearestTile(x: number, y: number): number {
    let best = drag?.index ?? 0;
    let distance = Infinity;
    for (const tile of grid?.querySelectorAll<HTMLElement>('[data-index]') ?? []) {
      const r = tile.getBoundingClientRect();
      const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
      if (d < distance) {
        distance = d;
        best = Number(tile.dataset['index']);
      }
    }
    return best;
  }

  function onUp() {
    // Still a press (no drag started, not a scroll): a tap.
    const tapped = press && !drag ? press.index : null;
    if (drag && target !== null && target !== drag.index) {
      const next = [...attachments];
      const [moved] = next.splice(drag.index, 1);
      next.splice(target, 0, moved!);
      onReorder(next);
    }
    stop();
    if (tapped !== null) viewing = tapped;
  }

  function stop() {
    if (press) clearTimeout(press.timer);
    press = null;
    drag = null;
    ghost = null;
    dragged = null;
    target = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', stop);
    window.removeEventListener('touchmove', blockScroll);
  }

  /** Once a drag runs, the dialog must not scroll under the finger. */
  function blockScroll(event: TouchEvent) {
    if (drag && event.cancelable) event.preventDefault();
  }
</script>

<svelte:window onpaste={onPaste} onkeydown={onKeydown} />

<dialog
  bind:this={dialog}
  class:dropping
  onclose={onClose}
  oncancel={(e) => {
    // Escape closes the large view first.
    if (viewing !== null) {
      e.preventDefault();
      viewing = null;
    }
  }}
  aria-labelledby="images-dialog-title"
  ondragover={(e) => {
    if (readOnly) return;
    e.preventDefault();
    dropping = true;
  }}
  ondragleave={(e) => {
    if (e.target === dialog) dropping = false;
  }}
  ondrop={onDrop}
>
  <div class="head">
    <h2 id="images-dialog-title" {title}>{title}</h2>
    {#if !readOnly}
      <IconButton icon="plus" label="Add photo" onclick={() => picker?.click()} />
    {/if}
    <IconButton icon="close" label="Close" onclick={onClose} />
  </div>
  <input
    bind:this={picker}
    class="picker"
    type="file"
    accept="image/png,image/jpeg,image/gif,image/webp"
    multiple
    tabindex="-1"
    onchange={(e) => {
      addFiles(e.currentTarget.files);
      e.currentTarget.value = '';
    }}
  />
  {#if !readOnly}
    <!-- Editable only so iPhone offers Paste on a long press; typing is ignored, no keyboard. -->
    <div
      class="paste"
      contenteditable="true"
      inputmode="none"
      role="textbox"
      tabindex="0"
      aria-label="Paste an image here"
      onbeforeinput={(e) => e.preventDefault()}
      ondrop={onDrop}
    >
      <span class="mouse">Paste or drop images here, or add a photo with +</span>
      <span class="touch">Tap and hold here to paste, or add a photo with +</span>
    </div>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if attachments.length === 0 && uploading === 0}
    <p class="empty">No images yet.</p>
  {:else}
    <div class="grid" role="list" bind:this={grid}>
      {#each attachments as attachment, i (attachment.id)}
        <div
          class="tile reveal-host"
          class:dragged={dragged === i}
          class:target={target === i && dragged !== i}
          data-index={i}
          role="button"
          tabindex="0"
          aria-label={`Image ${i + 1} of ${attachments.length}: show it large`}
          onpointerdown={(e) => onTileDown(e, i)}
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              viewing = i;
            }
          }}
        >
          {#await imageUrl(attachment.id)}
            <span class="loading"></span>
          {:then url}
            <img src={url} alt={attachment.alt} draggable="false" />
          {:catch}
            <span class="failed">Couldn't load</span>
          {/await}
          {#if !readOnly}
            <!-- With a mouse, on hover; touch screens remove from the large view. -->
            <span class="tile-remove reveal mouse-only">
              <IconButton
                icon="trash"
                label={`Remove image ${i + 1}`}
                title="Move to trash"
                onclick={() => onRemove(i)}
              />
            </span>
          {/if}
        </div>
      {/each}
      {#each [...Array(uploading).keys()] as i (i)}
        <div class="tile" role="listitem"><span class="loading">Uploading…</span></div>
      {/each}
    </div>
  {/if}
  {#if drag && ghost && dragged !== null && attachments[dragged]}
    <!-- The image being dragged, under the pointer (inside the dialog, so above it). -->
    <div
      class="tile ghost"
      style:width={`${drag.size}px`}
      style:height={`${drag.size}px`}
      style:transform={`translate(${ghost.x}px, ${ghost.y}px)`}
    >
      {#await imageUrl(attachments[dragged].id) then url}
        <img src={url} alt="" draggable="false" />
      {/await}
    </div>
  {/if}
  {#if viewing !== null && viewed}
    <div class="viewer" role="group" aria-label={`Image ${viewing + 1} of ${attachments.length}`}>
      <div class="viewer-bar">
        <span class="viewer-count">{viewing + 1} / {attachments.length}</span>
        {#if !readOnly}
          <IconButton
            icon="trash"
            label="Remove image"
            title="Move to trash"
            onclick={() => viewing !== null && remove(viewing)}
          />
        {/if}
        <IconButton icon="close" label="Close image" onclick={() => (viewing = null)} />
      </div>
      <div class="viewer-image">
        {#key viewed.id}
          {#await imageUrl(viewed.id)}
            <span class="loading">Loading…</span>
          {:then url}
            <img src={url} alt={viewed.alt} draggable="false" />
          {:catch}
            <span class="failed">Couldn't load</span>
          {/await}
        {/key}
      </div>
      {#if attachments.length > 1}
        <span class="viewer-prev">
          <IconButton icon="back" label="Previous image" onclick={() => step(-1)} />
        </span>
        <span class="viewer-next">
          <IconButton icon="forward" label="Next image" onclick={() => step(1)} />
        </span>
      {/if}
    </div>
  {/if}
  {@render children?.()}
</dialog>

<style>
  dialog {
    width: min(720px, calc(100vw - 32px));
    max-height: calc(100% - 64px);
    padding: 12px 8px 16px 20px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--bg);
    color: var(--text);
  }

  dialog[open] {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  dialog.dropping {
    outline: 2px dashed var(--accent);
    outline-offset: -6px;
  }

  dialog::backdrop {
    background: rgb(0 0 0 / 40%);
  }

  .head {
    display: flex;
    align-items: center;
  }

  /* Long card titles get the room and an ellipsis. */
  h2 {
    flex: 1;
    min-width: 0;
    margin: 0;
    overflow: hidden;
    font-size: 1.125rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .picker {
    display: none;
  }

  .paste {
    margin-right: 12px;
    padding: 12px;
    border: 1px dashed var(--border);
    border-radius: 8px;
    color: var(--text-muted);
    font-size: 0.875rem;
    text-align: center;
    caret-color: transparent;
    outline: none;
    cursor: default;
  }

  .touch {
    display: none;
  }

  @media (pointer: coarse) {
    .mouse {
      display: none;
    }

    .touch {
      display: inline;
    }
  }

  .paste:focus {
    border-color: var(--accent);
  }

  .error {
    margin: 0 12px 0 0;
    color: var(--danger);
    font-size: 0.875rem;
  }

  .empty {
    margin: 4px 0 8px;
    color: var(--text-muted);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 8px;
    min-height: 0;
    margin: 0;
    padding: 0 12px 0 0;
    overflow-y: auto;
    list-style: none;
  }

  .tile {
    position: relative;
    overflow: hidden;
    aspect-ratio: 1;
    border-radius: 8px;
    background: var(--bg-muted);
    cursor: grab;
    touch-action: pan-y;
    /* Press and hold to drag: no image menu or text selection. */
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    transition: opacity 120ms ease;
  }

  .ghost {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 10;
    opacity: 0.9;
    pointer-events: none;
    box-shadow: 0 6px 24px rgb(0 0 0 / 25%);
  }

  /* The trash button on a tile: sweeps in on hover (app.css .reveal); touch removes from the large view. */
  .tile-remove {
    position: absolute;
    top: 4px;
    right: 4px;
    justify-content: flex-end;
    border-radius: 8px;
    background: var(--bg);
  }

  .tile:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* The large view: the whole screen, the image as big as fits. */
  .viewer {
    position: fixed;
    inset: 0;
    z-index: 20;
    display: flex;
    flex-direction: column;
    background: rgb(0 0 0 / 96%);
  }

  /* White on the dark view in both themes (like the swipe actions). */
  .viewer :global(.icon-button) {
    color: #fff;
  }

  .viewer :global(.icon-button:hover) {
    background: rgb(255 255 255 / 15%);
    color: #fff;
  }

  .viewer-bar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding: max(6px, env(safe-area-inset-top)) 8px 6px 16px;
  }

  .viewer-count {
    flex: 1;
    color: #fff;
    font-size: 0.875rem;
    font-variant-numeric: tabular-nums;
  }

  .viewer-image {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    min-height: 0;
    padding: 0 16px max(16px, env(safe-area-inset-bottom));
  }

  .viewer-image img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    -webkit-touch-callout: none;
  }

  .viewer-prev,
  .viewer-next {
    position: absolute;
    top: 50%;
    border-radius: 8px;
    background: rgb(0 0 0 / 40%);
    transform: translateY(-50%);
  }

  .viewer-prev {
    left: 8px;
  }

  .viewer-next {
    right: 8px;
  }

  .tile.dragged {
    opacity: 0.35;
  }

  .tile.target {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .tile img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
  }

  .viewer-image img {
    display: block;
  }

  .loading,
  .failed {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-muted);
    font-size: 0.8125rem;
  }
</style>
