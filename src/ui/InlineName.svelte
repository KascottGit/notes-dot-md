<!--
  A name you rename by editing it in place: note titles, category names.
  Looks like plain text until hovered or focused. Enter or leaving the field
  saves, Escape cancels. Always use this for renaming, never a dialog.
-->
<script lang="ts">
  interface Props {
    value: string;
    /** For screen readers, e.g. "Note title". */
    label: string;
    readonly?: boolean;
    /** Save a new name. Resolves when done; the field then shows `value` again. */
    onCommit: (name: string) => Promise<void>;
    /** After Enter, e.g. to move on to the note text. */
    onDone?: () => void;
    /** True while a rename is being saved. */
    busy?: boolean;
  }

  let {
    value,
    label,
    readonly = false,
    onCommit,
    onDone,
    busy = $bindable(false),
  }: Props = $props();

  let input = $state<HTMLInputElement>();
  let draft = $state('');
  let editing = $state(false);

  // Show the current name, except while typing or while a rename is on its way.
  $effect(() => {
    const current = value;
    if (!editing && !busy) draft = current;
  });

  /** Focus with all text selected (e.g. a new note's "Untitled"). */
  export function focus() {
    input?.focus();
    input?.select();
  }

  async function commit() {
    const next = draft.trim();
    if (!next || next === value) {
      editing = false;
      draft = value;
      return;
    }
    busy = true;
    editing = false;
    try {
      await onCommit(next);
    } finally {
      // The field then shows the final name (it may differ, e.g. "Plan (2)").
      busy = false;
    }
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      input?.blur(); // Saves via blur.
      onDone?.();
    } else if (event.key === 'Escape') {
      draft = value;
      editing = false;
      input?.blur();
    }
  }
</script>

{#if readonly}
  <!-- Same box as the input, so editable and fixed names line up. -->
  <span class="inline-name" title={value}>{value}</span>
{:else}
  <input
    bind:this={input}
    class="inline-name"
    aria-label={label}
    title={draft}
    bind:value={draft}
    readonly={busy}
    enterkeyhint="done"
    autocomplete="off"
    spellcheck="false"
    onfocus={() => (editing = true)}
    onblur={commit}
    onkeydown={onKeydown}
  />
{/if}

<style>
  .inline-name {
    width: 100%;
    min-width: 0;
    margin-left: -6px;
    padding: 2px 6px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: none;
    color: var(--text);
    font-family: var(--font-heading);
    /* 16px+ so focusing it never zooms on phones. */
    font-size: 1.0625rem;
    font-weight: 600;
    text-overflow: ellipsis;
  }

  .inline-name:hover:not([readonly]) {
    border-color: var(--border);
  }

  .inline-name:focus:not([readonly]) {
    border-color: var(--accent);
    outline: none;
  }

  span.inline-name {
    display: block;
    overflow: hidden;
    white-space: nowrap;
  }
</style>
