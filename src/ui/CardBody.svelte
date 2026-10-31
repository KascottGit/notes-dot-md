<!--
  The markdown body of a board card (or the text above columns and cards),
  edited in place with the same live preview as notes. The board's file is
  the source of truth: edits go out through onChange, and new text coming in
  (a drag, a newer version from Drive) replaces what is shown.
-->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { bodyForFile } from '../editor/board';
  import { cardRules } from '../editor/cardRules';
  import { createEditor, type Editor } from '../editor/setup';

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

  let el = $state<HTMLDivElement>();
  let editor: Editor | null = null;
  /** The body as last sent to the file, so our own edits coming back are not reloaded. */
  let sent = '';

  onMount(() => {
    if (!el) return;
    sent = text;
    const ed = createEditor({
      parent: el,
      doc: text,
      readOnly,
      variant: 'card',
      extensions: [cardRules(readOnly ? '' : hint)],
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
  });

  $effect(() => {
    const incoming = text;
    if (!editor || incoming === sent) return;
    sent = incoming;
    editor.setText(incoming);
  });

  onDestroy(() => {
    if (!editor) return;
    onDestroyed(editor);
    editor.destroy();
  });
</script>

<div class="card-body" bind:this={el}></div>

<style>
  .card-body {
    min-width: 0;
  }
</style>
