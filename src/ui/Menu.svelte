<!--
  A small menu that opens under a button (the format bar's heading menu, the
  New button). The parent places it (it needs a positioned ancestor) and
  shows it while open. Closes on a tap outside or Escape.
-->
<script lang="ts" generics="Item extends { id: string; label: string }">
  import type { Snippet } from 'svelte';

  interface Props {
    items: Item[];
    /** For screen readers, e.g. "Heading". */
    label: string;
    onSelect: (item: Item) => void;
    onClose: () => void;
    /** The button that opens the menu: tapping it toggles instead of closing twice. */
    anchor?: HTMLElement | undefined;
    /** Keep focus (and the selection) in the editor when an item is tapped. */
    keepFocus?: boolean;
    /** Offset from the left edge of the positioned ancestor; otherwise lined up on the right. */
    left?: number;
    /** How an item looks; just its label when left out. */
    item?: Snippet<[Item]>;
  }

  let { items, label, onSelect, onClose, anchor, keepFocus = false, left, item }: Props = $props();

  let panel = $state<HTMLDivElement>();

  function cancel(event: Event) {
    if (keepFocus) event.preventDefault();
  }

  function onWindowPointerDown(event: PointerEvent) {
    const target = event.target as Node;
    if (panel?.contains(target) || anchor?.contains(target)) return;
    onClose();
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    onClose();
    anchor?.focus();
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} onkeydown={onKeydown} />

<div
  class="menu"
  role="menu"
  aria-label={label}
  bind:this={panel}
  style:left={left === undefined ? undefined : `${left}px`}
  style:right={left === undefined ? '0' : undefined}
>
  {#each items as it (it.id)}
    <button
      role="menuitem"
      class="item"
      onmousedown={cancel}
      onpointerdown={cancel}
      onclick={() => {
        onClose();
        onSelect(it);
      }}
    >
      {#if item}{@render item(it)}{:else}{it.label}{/if}
    </button>
  {/each}
</div>

<style>
  .menu {
    position: absolute;
    top: calc(100% + 4px);
    z-index: 20;
    display: flex;
    flex-direction: column;
    min-width: 200px;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg);
    box-shadow: 0 6px 24px rgb(0 0 0 / 18%);
  }

  .item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-height: 44px;
    padding: 0 12px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background-color 120ms ease;
  }

  .item:hover {
    background: var(--bg-muted);
  }
</style>
