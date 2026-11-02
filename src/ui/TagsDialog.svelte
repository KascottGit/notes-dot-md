<!--
  The Tags list (SPEC "Tags"): every tag in use, how many notes use it, and
  its color. Tapping a tag shows the color swatches; a pick applies at once.
-->
<script lang="ts">
  import type { TagSuggestion } from '../editor/tagComplete';
  import { TAG_COLOR_LABELS, TAG_COLORS, type TagColor, type TagColors } from '../store/tagColors';
  import Icon from './Icon.svelte';
  import IconButton from './IconButton.svelte';

  interface Props {
    open: boolean;
    tags: TagSuggestion[];
    colors: TagColors;
    onPick: (tag: string, color: TagColor | null) => void;
    onClose: () => void;
  }

  let { open, tags, colors, onPick, onClose }: Props = $props();

  let dialog = $state<HTMLDialogElement>();
  /** The tag whose swatches show (lower case), or null. */
  let expanded = $state<string | null>(null);

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      expanded = null;
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  });

  const plural = (n: number) => `${n} ${n === 1 ? 'note' : 'notes'}`;
</script>

<dialog bind:this={dialog} onclose={onClose} aria-labelledby="tags-dialog-title">
  <div class="head">
    <h2 id="tags-dialog-title">Tags</h2>
    <IconButton icon="close" label="Close" onclick={onClose} />
  </div>
  {#if tags.length === 0}
    <p class="empty">No tags yet. Type # and a word in a note or on a card to add one.</p>
  {:else}
    <ul>
      {#each tags as t (t.tag.toLowerCase())}
        {@const key = t.tag.toLowerCase()}
        {@const color = colors[key] ?? null}
        <li>
          <button
            class="row"
            aria-expanded={expanded === key}
            title={`#${t.tag}`}
            onclick={() => (expanded = expanded === key ? null : key)}
          >
            <span class="name"><span class="tag" data-tag={key}>#{t.tag}</span></span>
            <span class="count">{plural(t.count)}</span>
            <Icon name="chevronDown" size={16} />
          </button>
          {#if expanded === key}
            <div class="swatches" role="group" aria-label={`Color for #${t.tag}`}>
              <button
                class="swatch none"
                class:current={color === null}
                aria-pressed={color === null}
                aria-label="No color"
                title="No color"
                onclick={() => onPick(t.tag, null)}
              >
                <span class="dot"></span>
              </button>
              {#each TAG_COLORS as c (c)}
                <button
                  class="swatch"
                  class:current={color === c}
                  aria-pressed={color === c}
                  aria-label={TAG_COLOR_LABELS[c]}
                  title={TAG_COLOR_LABELS[c]}
                  onclick={() => onPick(t.tag, c)}
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
    justify-content: space-between;
  }

  h2 {
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

  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
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

  .count {
    flex: none;
    font-size: 0.8125rem;
    font-variant-numeric: tabular-nums;
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

  /* "No color": an empty ring. */
  .none .dot {
    border: 2px dashed var(--text-muted);
  }

  /* The current color: a ring around it. */
  .swatch.current .dot {
    box-shadow:
      0 0 0 2px var(--bg),
      0 0 0 4px var(--text);
  }
</style>
