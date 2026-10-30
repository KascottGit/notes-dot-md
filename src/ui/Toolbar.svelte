<!--
  The format bar, under the note title on every screen size. Every button runs
  the same command as its keyboard shortcut. Buttons cancel mousedown/pointerdown
  so the editor keeps focus and selection.
-->
<script lang="ts">
  import type { StateCommand } from '@codemirror/state';
  import {
    toggleBold,
    toggleBulletList,
    toggleChecklist,
    toggleCodeBlock,
    toggleHeading,
    toggleInlineCode,
    toggleItalic,
    toggleLink,
    toggleNumberedList,
    toggleQuote,
    toggleStrikethrough,
  } from '../editor/commands';
  import { indentItem, moveItemDown, moveItemUp, outdentItem } from '../editor/lists';
  import Icon, { type IconName } from './Icon.svelte';

  interface Props {
    run: (command: StateCommand) => void;
  }

  let { run }: Props = $props();

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = isMac ? '⌘' : 'Ctrl+';
  const alt = isMac ? '⌥' : 'Alt+';
  const shift = isMac ? '⇧' : 'Shift+';

  interface Button {
    id: IconName;
    label: string;
    shortcut: string;
    command: StateCommand;
  }

  const inline: Button[] = [
    { id: 'bold', label: 'Bold', shortcut: `${mod}B`, command: toggleBold },
    { id: 'italic', label: 'Italic', shortcut: `${mod}I`, command: toggleItalic },
    {
      id: 'strike',
      label: 'Strikethrough',
      shortcut: `${mod}${shift}X`,
      command: toggleStrikethrough,
    },
    { id: 'code', label: 'Inline code', shortcut: `${mod}E`, command: toggleInlineCode },
    { id: 'link', label: 'Link', shortcut: `${mod}K`, command: toggleLink },
  ];

  const blocks: Button[] = [
    { id: 'bullet', label: 'Bullet list', shortcut: `${mod}${shift}8`, command: toggleBulletList },
    {
      id: 'number',
      label: 'Numbered list',
      shortcut: `${mod}${shift}7`,
      command: toggleNumberedList,
    },
    { id: 'task', label: 'Checklist', shortcut: `${mod}${shift}9`, command: toggleChecklist },
    { id: 'quote', label: 'Quote', shortcut: `${mod}${shift}.`, command: toggleQuote },
    { id: 'codeblock', label: 'Code block', shortcut: `${mod}${alt}C`, command: toggleCodeBlock },
  ];

  // Same commands as Alt+↑/↓ and Tab/Shift+Tab. In a list they move or nest
  // the whole item with its sub-items.
  const lines: Button[] = [
    { id: 'moveUp', label: 'Move up', shortcut: `${alt}↑`, command: moveItemUp },
    { id: 'moveDown', label: 'Move down', shortcut: `${alt}↓`, command: moveItemDown },
    { id: 'outdent', label: 'Outdent', shortcut: `${shift}Tab`, command: outdentItem },
    { id: 'indent', label: 'Indent', shortcut: 'Tab', command: indentItem },
  ];

  const headings = ([1, 2, 3] as const).map((level) => ({
    level,
    label: `Heading ${level}`,
    shortcut: `${mod}${alt}${level}`,
    command: toggleHeading(level),
  }));

  let menuOpen = $state(false);
  let menuButton = $state<HTMLButtonElement>();
  let root = $state<HTMLDivElement>();

  /** Keep focus and selection in the editor. */
  function keepFocus(event: Event) {
    event.preventDefault();
  }

  function choose(command: StateCommand) {
    menuOpen = false;
    run(command);
  }

  function onWindowPointerDown(event: PointerEvent) {
    if (!menuOpen) return;
    const target = event.target as Node;
    if (!root?.contains(target)) menuOpen = false;
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && menuOpen) {
      menuOpen = false;
      menuButton?.focus();
    }
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} onkeydown={onKeydown} />

<div class="toolbar" role="toolbar" aria-label="Formatting" bind:this={root}>
  <div class="scroll">
    <button
      bind:this={menuButton}
      class="tool text"
      aria-label="Heading"
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      title="Heading"
      onmousedown={keepFocus}
      onpointerdown={keepFocus}
      onclick={() => (menuOpen = !menuOpen)}
    >
      H<span class="caret" aria-hidden="true">▾</span>
    </button>

    {#each [inline, blocks, lines] as group, i (i)}
      <span class="sep" aria-hidden="true"></span>
      {#each group as b (b.id)}
        <button
          class="tool"
          aria-label={b.label}
          title={`${b.label} (${b.shortcut})`}
          onmousedown={keepFocus}
          onpointerdown={keepFocus}
          onclick={() => choose(b.command)}
        >
          <Icon name={b.id} />
        </button>
      {/each}
    {/each}
  </div>
  {#if menuOpen}
    <div class="menu" role="menu">
      {#each headings as h (h.level)}
        <button
          role="menuitem"
          class="item"
          title={`${h.label} (${h.shortcut})`}
          onmousedown={keepFocus}
          onpointerdown={keepFocus}
          onclick={() => choose(h.command)}
        >
          <span class="h h{h.level}">{h.label}</span>
          <span class="kbd">{h.shortcut}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .toolbar {
    position: relative;
    z-index: 10;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
  }

  .scroll {
    display: flex;
    align-items: center;
    max-width: 760px;
    margin: 0 auto;
    padding: 2px 8px;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .scroll::-webkit-scrollbar {
    display: none;
  }

  .tool {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    height: 44px;
    padding: 0 8px;
    border: 0;
    border-radius: 8px;
    background: none;
    color: var(--text);
    font: inherit;
    cursor: pointer;
    transition: background-color 120ms ease;
  }

  .tool:hover {
    background: var(--bg-muted);
  }

  .tool:active {
    background: var(--selection);
  }

  .tool.text {
    gap: 2px;
    font-weight: 700;
  }

  .caret {
    color: var(--text-muted);
    font-size: 0.7em;
  }

  .sep {
    flex: none;
    width: 1px;
    height: 24px;
    margin: 0 2px;
    background: var(--border);
  }

  /* Opens below the H button, over the note. */
  .menu {
    position: absolute;
    top: calc(100% + 4px);
    left: calc(max(0px, (100% - 760px) / 2) + 8px);
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
  }

  .item:hover {
    background: var(--bg-muted);
  }

  .h {
    font-weight: 700;
  }

  .h1 {
    font-size: 1.25rem;
  }

  .h2 {
    font-size: 1.1rem;
  }

  .h3 {
    font-size: 1rem;
  }

  .kbd {
    color: var(--text-muted);
    font-size: 0.75rem;
  }

  /* Small screens: no shortcut hints in the heading menu. */
  @media (max-width: 899px) {
    .kbd {
      display: none;
    }
  }
</style>
