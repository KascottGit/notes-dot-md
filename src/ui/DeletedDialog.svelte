<!--
  Recently deleted notes (SPEC "Delete a note"): notes in the Drive trash
  that came from the categories, with a restore button each.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import IconButton from './IconButton.svelte';
  import SwipeItem from './SwipeItem.svelte';

  interface Props {
    open: boolean;
    loading: boolean;
    error: string | null;
    items: { id: string; title: string; category: string; when: string; board: boolean }[];
    onRestore: (id: string) => void;
    /** Delete a trashed note for good (the app asks to confirm first). */
    onDelete: (id: string) => void;
    onClose: () => void;
    /** Shown inside the dialog, e.g. a toast. */
    children?: Snippet;
  }

  let { open, loading, error, items, onRestore, onDelete, onClose, children }: Props = $props();

  let dialog = $state<HTMLDialogElement>();

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });
</script>

<dialog bind:this={dialog} onclose={onClose} aria-labelledby="deleted-dialog-title">
  <div class="head">
    <h2 id="deleted-dialog-title">Recently deleted</h2>
    <IconButton icon="close" label="Close" onclick={onClose} />
  </div>
  <p class="hint">Deleted notes stay in the Google Drive trash for 30 days.</p>
  {#if error}
    <p class="message error" role="alert">{error}</p>
  {:else if loading}
    <p class="message">Loading…</p>
  {:else if items.length === 0}
    <p class="message">Nothing deleted recently.</p>
  {:else}
    <ul>
      {#each items as item (item.id)}
        <li>
          <!-- Touch: swipe left for Delete, as in the note list. Mouse: trash on hover. -->
          <SwipeItem onDelete={() => onDelete(item.id)}>
            <div class="row reveal-host">
              <div class="text">
                <span class="title" title={item.title}>{item.title}</span>
                <span class="meta">
                  {item.board ? 'Board' : 'Note'} · {item.category} · deleted {item.when}
                </span>
              </div>
              <IconButton
                icon="restore"
                label={`Restore ${item.title}`}
                title="Restore"
                onclick={() => onRestore(item.id)}
              />
              <span class="reveal mouse-only">
                <IconButton
                  icon="trash"
                  label={`Delete ${item.title} for good`}
                  title="Delete for good"
                  onclick={() => onDelete(item.id)}
                />
              </span>
            </div>
          </SwipeItem>
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

  .hint,
  .message {
    margin: 0 12px 8px 0;
    color: var(--text-muted);
    font-size: 0.875rem;
  }

  .message {
    margin-top: 8px;
    font-size: 1rem;
  }

  .error {
    color: var(--danger);
  }

  ul {
    min-height: 0;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }

  li {
    border-top: 1px solid var(--border);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 52px;
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
  .meta {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .title {
    font-weight: 600;
  }

  .meta {
    color: var(--text-muted);
    font-size: 0.8125rem;
  }
</style>
