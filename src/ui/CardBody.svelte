<!--
  The markdown body of a board card (or the text above columns and cards),
  edited in place with the same live preview as notes. The board's file is
  the source of truth: edits go out through onChange, and new text coming in
  (a drag, a newer version from Drive) replaces what is shown.
-->
<script lang="ts">
  import { getContext, onDestroy, onMount } from 'svelte';
  import { bodyForFile } from '../editor/board';
  import { cardRules } from '../editor/cardRules';
  import { createEditor, type Editor } from '../editor/setup';
  import type { TagSuggestion } from '../editor/tagComplete';

  interface Props {
    text: string;
    readOnly: boolean;
    /** Shown when the body is empty. */
    hint?: string;
    onChange: (text: string) => void;
    onFocus: (editor: Editor) => void;
    onDestroyed: (editor: Editor) => void;
    onSave: () => void;
  }

  let { text, readOnly, hint = '', onChange, onFocus, onDestroyed, onSave }: Props = $props();

  /** Every tag in use, for autocomplete (from the workspace). */
  const tags = getContext<(() => TagSuggestion[]) | undefined>('tags');

  /** The board's undo and redo: one history for the whole file (from the workspace). */
  const history = getContext<{ undo: () => void; redo: () => void } | undefined>('history');

  let el = $state<HTMLDivElement>();
  let editor: Editor | null = null;
  /** The body as last sent to the file, so our own edits coming back are not reloaded. */
  let sent = '';

  /**
   * The editor is made when the card comes near the screen: a board can hold
   * hundreds of cards, and an editor each is slow to build. Until then the
   * text shows as it is.
   */
  let ready = $state(false);
  const NEAR_PX = 800;
  let watcher: IntersectionObserver | null = null;

  function near(box: DOMRect): boolean {
    return (
      box.bottom > -NEAR_PX &&
      box.top < window.innerHeight + NEAR_PX &&
      box.right > -NEAR_PX &&
      box.left < window.innerWidth + NEAR_PX
    );
  }

  /** The nearest box around `node` that scrolls up and down, or null for the page. */
  function scroller(node: HTMLElement): HTMLElement | null {
    for (let up = node.parentElement; up && up !== document.body; up = up.parentElement) {
      if (/auto|scroll/.test(getComputedStyle(up).overflowY)) return up;
    }
    return null;
  }

  function create() {
    watcher?.disconnect();
    watcher = null;
    if (!el || editor) return;
    ready = true;
    sent = text;
    const ed = createEditor({
      parent: el,
      doc: text,
      readOnly,
      variant: 'card',
      extensions: [cardRules(readOnly ? '' : hint)],
      ...(tags ? { tags } : {}),
      ...(history ? { history } : {}),
      onChange: () => {
        const current = ed.getText();
        sent = bodyForFile(current);
        onChange(current);
      },
      onSave,
      onBlur: () => {
        // Show the text as the file has it (e.g. without trailing blank lines).
        ed.setText(text);
        sent = text;
        onSave();
      },
      onFocus: () => onFocus(ed),
    });
    editor = ed;
  }

  onMount(() => {
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined' || near(el.getBoundingClientRect())) {
      create();
      return;
    }
    watcher = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) create();
      },
      // Measured from the box the card scrolls in: a margin around the
      // screen doesn't reach into a column that scrolls by itself.
      { root: scroller(el), rootMargin: `${NEAR_PX}px` },
    );
    watcher.observe(el);
  });

  $effect(() => {
    const incoming = text;
    if (!editor || incoming === sent) return;
    sent = incoming;
    editor.setText(incoming);
  });

  onDestroy(() => {
    watcher?.disconnect();
    if (!editor) return;
    onDestroyed(editor);
    editor.destroy();
  });
</script>

<div class="card-body" bind:this={el}>
  {#if !ready}
    <!-- Sized like the editor's text, so little moves when the editor takes over. -->
    <div class="plain" class:hint={!text}>{text || (readOnly ? '' : hint)}</div>
  {/if}
</div>

<style>
  .card-body {
    min-width: 0;
  }

  .plain {
    min-height: 1.55em;
    padding: 0 12px 2px 3px;
    font-family: var(--font-body);
    font-size: 16px;
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .plain.hint {
    color: var(--text-muted);
  }
</style>
