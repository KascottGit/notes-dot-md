<!--
  The Tags list (SPEC "Tags"): the open note's or board's saved tags, each
  with its color. They are suggested while typing in it. Tapping a tag shows the color
  swatches; a pick applies at once. Add and remove are here too.
-->
<script lang="ts">
  import {
    savedTags,
    TAG_COLOR_LABELS,
    TAG_COLORS,
    type TagColor,
    type TagColors,
  } from '../store/tagColors';
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import SwipeItem from './SwipeItem.svelte';
  import IconButton from './IconButton.svelte';

  interface Props {
    open: boolean;
    colors: TagColors;
    /** What is open, for the wording. */
    kind?: 'note' | 'board';
    /** The tag whose swatches show, or null. */
    expanded?: string | null;
    onPick: (tag: string, color: TagColor) => void;
    onAdd: () => void;
    onRemove: (tag: string) => void;
    onClose: () => void;
    /** Shown inside the dialog, e.g. the toast with Undo. */
    children?: Snippet;
  }

  let {
    open,
    colors,
    kind = 'note',
    expanded = $bindable(null),
    onPick,
    onAdd,
    onRemove,
    onClose,
    children,
  }: Props = $props();

  let dialog = $state<HTMLDialogElement>();
  const tags = $derived(savedTags(colors));

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });
</script>

<dialog bind:this={dialog} onclose={onClose} aria-labelledby="tags-dialog-title">
  <div class="head">
    <h2 id="tags-dialog-title">Tags</h2>
    <IconButton icon="plus" label="Add tag" onclick={onAdd} />
    <IconButton icon="close" label="Close" onclick={onClose} />
  </div>
  {#if tags.length === 0}
    <p class="empty">
      No saved tags in this {kind} yet. Add one to give it a color and have it suggested while you type
      here.
    </p>
  {:else}
    <ul>
      {#each tags as tag (tag)}
        {@const color = colors[tag]}
        <li>
          <!-- Touch: swipe left for Delete, as in the note list. Mouse: trash on hover. -->
          <SwipeItem onDelete={() => onRemove(tag)}>
            <div class="line reveal-host">
              <button
                class="row"
                aria-expanded={expanded === tag}
                title={`#${tag}: choose a color`}
                onclick={() => (expanded = expanded === tag ? null : tag)}
              >
                <span class="name"><span class="tag" data-tag={tag}>#{tag}</span></span>
                <Icon name="chevronDown" size={16} />
              </button>
              <span class="reveal mouse-only">
                <IconButton
                  icon="trash"
                  label={`Remove #${tag}`}
                  title="Remove from saved tags"
                  onclick={() => onRemove(tag)}
                />
              </span>
            </div>
          </SwipeItem>
          {#if expanded === tag}
            <div class="swatches" role="group" aria-label={`Color for #${tag}`}>
              {#each TAG_COLORS as c (c)}
                <button
                  class="swatch"
                  class:current={color === c}
                  aria-pressed={color === c}
                  aria-label={TAG_COLOR_LABELS[c]}
                  title={TAG_COLOR_LABELS[c]}
                  onclick={() => onPick(tag, c)}
                >
                  <span class="dot" style:background={`var(--tag-${c})`}></span>
                </button>
              {/each}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
  {@render children?.()}
</dialog>

<style>
  dialog {
    /* Room for all ten swatches in one row on wider screens. */
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
    margin: 4px 0 0 -12px;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }

  .line {
    display: flex;
    align-items: center;
  }

  .row {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 10px;
    min-width: 0;
    min-height: 44px;
    padding: 0 12px;
    border: 0;
    border-radius: 8px;
    background: none;
    color: var(--text-muted);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background-color 120ms ease;
  }

  .row:hover {
    background: var(--bg-muted);
  }

  .row[aria-expanded='true'] :global(svg) {
    transform: rotate(180deg);
  }

  /* Long tag names get the room and an ellipsis. */
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* The same look as a tag in a note. */
  .tag {
    padding: 2px 7px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--tag-color, var(--accent)) 14%, transparent);
    color: var(--tag-color, var(--accent));
    font-size: 0.9375rem;
    font-weight: 500;
  }

  .swatches {
    display: flex;
    flex-wrap: wrap;
    padding: 2px 4px 8px;
  }

  .swatch {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: none;
    cursor: pointer;
  }

  .dot {
    width: 26px;
    height: 26px;
    border: 2px solid transparent;
    border-radius: 50%;
    transition: transform 120ms ease;
  }

  .swatch:hover .dot {
    transform: scale(1.1);
  }

  /* The current color: a ring around it. */
  .swatch.current .dot {
    box-shadow:
      0 0 0 2px var(--bg),
      0 0 0 4px var(--text);
  }
</style>
