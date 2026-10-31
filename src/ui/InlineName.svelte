<!--
  A name you rename by editing it in place: note titles, category names.
  Looks like plain text until hovered or focused. Enter or leaving the field
  saves, Escape cancels. Always use this for renaming, never a dialog.
  With `wrap`, a long name wraps onto more lines instead of being cut off
  (board card titles); it is still one line of text.
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
    /** Wrap long names onto more lines instead of cutting them off. */
    wrap?: boolean;
  }

  let {
    value,
    label,
    readonly = false,
    onCommit,
    onDone,
    busy = $bindable(false),
    wrap = false,
  }: Props = $props();

  let input = $state<HTMLInputElement | HTMLTextAreaElement>();

  /** A wrapping field is as tall as its text, also when its width changes. */
  /** The width the height was last worked out for. */
  let fittedWidth = -1;

  function fit() {
    const el = input;
    if (!(el instanceof HTMLTextAreaElement)) return;
    fittedWidth = el.clientWidth;
    // Measuring collapses the field for a moment. Hold its surroundings at their
    // height meanwhile, or a scrollbar around it can come and go and change
    // the width being measured.
    const parent = el.parentElement;
    const held = parent?.style.minHeight ?? '';
    if (parent) parent.style.minHeight = `${parent.offsetHeight}px`;
    el.style.height = 'auto';
    // The text's height plus the field's border (its box includes the border).
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
    if (parent) parent.style.minHeight = held;
  }

  /** Again after the layout settles (e.g. a scrollbar appearing narrows the column). */
  const refit = () => {
    fit();
    requestAnimationFrame(fit);
  };

  $effect(() => {
    void draft;
    fit();
  });

  $effect(() => {
    const el = input;
    if (!(el instanceof HTMLTextAreaElement)) return;
    const observer = new ResizeObserver(() => {
      // Only a new width changes the wrapping (our own height changes don't).
      if (el.clientWidth !== fittedWidth) refit();
    });
    observer.observe(el);
    refit();
    // Text gets wider or narrower when the web font arrives.
    void document.fonts.ready.then(refit);
    document.fonts.addEventListener('loadingdone', refit);
    return () => {
      observer.disconnect();
      document.fonts.removeEventListener('loadingdone', refit);
    };
  });
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
  <span class="inline-name" class:wrap title={value}>{value}</span>
{:else if wrap}
  <textarea
    bind:this={input}
    class="inline-name wrap"
    rows="1"
    aria-label={label}
    bind:value={draft}
    readonly={busy}
    enterkeyhint="done"
    autocomplete="off"
    spellcheck="false"
    onfocus={() => (editing = true)}
    onblur={commit}
    onkeydown={onKeydown}
    oninput={() => {
      // Still one line of text: a pasted line break becomes a space.
      if (/\n/.test(draft)) draft = draft.replace(/\s*\n\s*/g, ' ');
    }}></textarea>
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

  .inline-name.wrap {
    display: block;
    overflow: hidden;
    line-height: 1.3;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  textarea.inline-name {
    resize: none;
  }
</style>
