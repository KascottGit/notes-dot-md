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

  interface Props {
    run: (command: StateCommand) => void;
  }

  let { run }: Props = $props();

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = isMac ? '⌘' : 'Ctrl+';
  const alt = isMac ? '⌥' : 'Alt+';
  const shift = isMac ? '⇧' : 'Shift+';

  interface Button {
    id: string;
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

{#snippet icon(id: string)}
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {#if id === 'bold'}
      <path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" class="thick" />
    {:else if id === 'italic'}
      <path d="M10 5h8M6 19h8M14 5l-4 14" />
    {:else if id === 'strike'}
      <path
        d="M4 12h16M16 7.5C15.4 6 14 5 12 5c-2.5 0-4 1.3-4 3 0 1.5 1 2.4 3 3M8 16.5c.6 1.5 2 2.5 4 2.5 2.5 0 4-1.3 4-3 0-.7-.2-1.3-.6-1.8"
      />
    {:else if id === 'code'}
      <path d="M9 7l-5 5 5 5M15 7l5 5-5 5" />
    {:else if id === 'link'}
      <path
        d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"
      />
    {:else if id === 'bullet'}
      <path d="M10 6h10M10 12h10M10 18h10" /><circle cx="5" cy="6" r="1.3" class="dot" /><circle
        cx="5"
        cy="12"
        r="1.3"
        class="dot"
      /><circle cx="5" cy="18" r="1.3" class="dot" />
    {:else if id === 'number'}
      <path
        d="M10 6h10M10 12h10M10 18h10M4 5l1.5-1V9M3.5 14.5c.3-.8 1-1.2 1.7-1.2.9 0 1.5.6 1.5 1.3 0 1.2-3.2 2.4-3.2 3.9h3.4"
        class="thin"
      />
    {:else if id === 'task'}
      <rect x="3.5" y="4" width="6" height="6" rx="1.2" /><path
        d="M4.7 16.6l1.5 1.5 2.8-3M13 7h7M13 17h7"
      />
    {:else if id === 'quote'}
      <path d="M5 6v12M10 8h9M10 12h9M10 16h6" />
    {:else if id === 'codeblock'}
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path
        d="M10 9.5l-2.5 2.5 2.5 2.5M14 9.5l2.5 2.5-2.5 2.5"
      />
    {/if}
  </svg>
{/snippet}

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

    <span class="sep" aria-hidden="true"></span>

    {#each inline as b (b.id)}
      <button
        class="tool"
        aria-label={b.label}
        title={`${b.label} (${b.shortcut})`}
        onmousedown={keepFocus}
        onpointerdown={keepFocus}
        onclick={() => choose(b.command)}
      >
        {@render icon(b.id)}
      </button>
    {/each}

    <span class="sep" aria-hidden="true"></span>

    {#each blocks as b (b.id)}
      <button
        class="tool"
        aria-label={b.label}
        title={`${b.label} (${b.shortcut})`}
        onmousedown={keepFocus}
        onpointerdown={keepFocus}
        onclick={() => choose(b.command)}
      >
        {@render icon(b.id)}
      </button>
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
    gap: 2px;
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

  svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  svg :global(.thick) {
    stroke-width: 2.4;
  }

  svg :global(.thin) {
    stroke-width: 1.5;
  }

  svg :global(.dot) {
    fill: currentColor;
    stroke: none;
  }

  .sep {
    flex: none;
    width: 1px;
    height: 24px;
    margin: 0 4px;
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
