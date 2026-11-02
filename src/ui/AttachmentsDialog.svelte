<!--
  A card's image board (SPEC "Image attachments on cards"): its images as a
  tidy grid. Add by pasting, dropping files or the add button; drag a tile to
  reorder (on touch, press and hold first).
-->
<script lang="ts">
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
    onClose: () => void;
  }

  let { open, title, attachments, uploading, error, readOnly, onFiles, onReorder, onClose }: Props =
    $props();

  let dialog = $state<HTMLDialogElement>();
  let picker = $state<HTMLInputElement>();
  let grid = $state<HTMLElement>();
  let dropping = $state(false);

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
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

  function onTileDown(event: PointerEvent, index: number) {
    if (readOnly || event.button !== 0 || press || drag) return;
    const touch = event.pointerType !== 'mouse';
    if (!touch) event.preventDefault();
    press = { index, x: event.clientX, y: event.clientY, touch, timer: 0 };
    if (touch) press.timer = window.setTimeout(() => press && beginDrag(press.x, press.y), HOLD_MS);
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
      stop(); // A scroll, not a hold.
    else if (!press.touch && moved > 5) {
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
    if (drag && target !== null && target !== drag.index) {
      const next = [...attachments];
      const [moved] = next.splice(drag.index, 1);
      next.splice(target, 0, moved!);
      onReorder(next);
    }
    stop();
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

<svelte:window onpaste={onPaste} />

<dialog
  bind:this={dialog}
  class:dropping
  onclose={onClose}
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
    <ul class="grid" bind:this={grid}>
      {#each attachments as attachment, i (attachment.id)}
        <li
          class="tile"
          class:dragged={dragged === i}
          class:target={target === i && dragged !== i}
          data-index={i}
          onpointerdown={(e) => onTileDown(e, i)}
        >
          {#await imageUrl(attachment.id)}
            <span class="loading"></span>
          {:then url}
            <img src={url} alt={attachment.alt} draggable="false" />
          {:catch}
            <span class="failed">Couldn't load</span>
          {/await}
        </li>
      {/each}
      {#each [...Array(uploading).keys()] as i (i)}
        <li class="tile"><span class="loading">Uploading…</span></li>
      {/each}
    </ul>
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

  .tile.dragged {
    opacity: 0.35;
  }

  .tile.target {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
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
