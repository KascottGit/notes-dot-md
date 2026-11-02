<!--
  A board's archived cards (SPEC "Board view", Archive): deleted cards sit in
  a hidden `# Archive` column; here they can be taken back out.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import IconButton from './IconButton.svelte';

  interface Props {
    open: boolean;
    cards: { title: string; excerpt: string }[];
    /** Where restored cards go (the board's first column), or null if there is none. */
    target: string | null;
    readOnly: boolean;
    onRestore: (index: number) => void;
    onClose: () => void;
    /** Shown inside the dialog, e.g. the toast with Undo. */
    children?: Snippet;
  }

  let { open, cards, target, readOnly, onRestore, onClose, children }: Props = $props();

  let dialog = $state<HTMLDialogElement>();

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });
</script>

<dialog bind:this={dialog} onclose={onClose} aria-labelledby="archive-dialog-title">
  <div class="head">
    <h2 id="archive-dialog-title">Archive</h2>
    <IconButton icon="close" label="Close" onclick={onClose} />
  </div>
  {#if cards.length === 0}
    <p class="empty">No archived cards. Deleted cards end up here.</p>
  {:else}
    <ul>
      {#each cards as card, i (i)}
        <li>
          <div class="text">
            <span class="title" title={card.title}>{card.title}</span>
            {#if card.excerpt}<span class="excerpt">{card.excerpt}</span>{/if}
          </div>
          {#if !readOnly && target}
            <IconButton
              icon="restore"
              label={`Restore ${card.title} to ${target}`}
              title={`Restore to ${target}`}
              onclick={() => onRestore(i)}
            />
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
  {@render children?.()}
</dialog>

<style>
  dialog {
    width: min(480px, calc(100vw - 32px));
    max-height: min(640px, calc(100% - 64px));
    padding: 12px 8px 12px 20px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--bg);
    color: var(--text);
  }

  dialog[open] {
    display: flex;
    flex-direction: column;
  }

  dialog::backdrop {
    background: rgb(0 0 0 / 40%);
  }

  .head {
    display: flex;
    align-items: center;
  }

  h2 {
    flex: 1;
    margin: 0;
    font-size: 1.125rem;
  }

  .empty {
    margin: 8px 12px 12px 0;
    color: var(--text-muted);
  }

  ul {
    min-height: 0;
    margin: 4px 0 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }

  li {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 52px;
    border-top: 1px solid var(--border);
  }

  li:first-child {
    border-top: 0;
  }

  /* Long titles get the room and an ellipsis. */
  .text {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    padding: 6px 0;
  }

  .title,
  .excerpt {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .title {
    font-weight: 600;
  }

  .excerpt {
    color: var(--text-muted);
    font-size: 0.875rem;
  }
</style>
