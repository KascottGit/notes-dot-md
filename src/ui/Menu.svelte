<!--
  A small menu that opens under a button (the format bar's heading menu, the
  New button, the note's outline). The parent places it (it needs a
  positioned ancestor) and shows it while open. Closes on a tap outside or
  Escape. Long lists scroll; ↑ / ↓ move between the items.
-->
<script lang="ts" generics="Item extends { id: string; label: string }">
  import { onMount, type Snippet } from 'svelte';

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
    /** The item to mark as where you are (the outline's current heading), scrolled into view. */
    current?: string | undefined;
    /** Put the focus on the current (or first) item, for the arrow keys. */
    focusOnOpen?: boolean;
  }

  let {
    items,
    label,
    onSelect,
    onClose,
    anchor,
    keepFocus = false,
    left,
    item,
    current,
    focusOnOpen = false,
  }: Props = $props();

  let panel = $state<HTMLDivElement>();
  /** Where the focus was, for Escape to put it back (the editor, after Ctrl+Shift+O). */
  const before = document.activeElement;

  const buttons = () => Array.from(panel?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  onMount(() => {
    const list = buttons();
    const mark = list.find((b) => b.getAttribute('aria-current') === 'location');
    if (mark && panel) {
      // By hand: scrollIntoView would also scroll the page's own hidden overflow.
      panel.scrollTop = mark.offsetTop - (panel.clientHeight - mark.offsetHeight) / 2;
    }
    if (focusOnOpen) (mark ?? list[0])?.focus({ preventScroll: true });
  });

  function cancel(event: Event) {
    if (keepFocus) event.preventDefault();
  }

  function onWindowPointerDown(event: PointerEvent) {
    const target = event.target as Node;
    if (panel?.contains(target) || anchor?.contains(target)) return;
    onClose();
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      onClose();
      const back = before instanceof HTMLElement && before !== document.body ? before : anchor;
      if (back?.isConnected) back.focus();
      else anchor?.focus();
      return;
    }
    // Arrow keys only while the focus is in the menu (not the editor behind a heading menu).
    const list = buttons();
    const at = list.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    const to =
      event.key === 'ArrowDown'
        ? (at + 1) % list.length
        : event.key === 'ArrowUp'
          ? (at - 1 + list.length) % list.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? list.length - 1
              : -1;
    if (to < 0) return;
    event.preventDefault();
    list[to]?.focus();
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
      class:current={it.id === current}
      aria-current={it.id === current ? 'location' : undefined}
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
    max-width: calc(100vw - 24px);
    max-height: min(60vh, 480px);
    padding: 4px;
    overflow-y: auto;
    overscroll-behavior: contain;
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

  .item:focus-visible {
    background: var(--bg-muted);
    outline: none;
  }

  /* Not on touch screens, where a tap leaves the item under the finger "hovered". */
  @media (hover: hover) {
    .item:hover {
      background: var(--bg-muted);
    }
  }

  .item.current {
    color: var(--accent);
  }
</style>
