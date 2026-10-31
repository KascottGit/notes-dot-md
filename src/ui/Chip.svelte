<!--
  A filter chip: the note list's categories and the board's tags. Use it for
  every "pick one of these" row, inside a ChipRow.
-->
<script lang="ts">
  interface Props {
    label: string;
    /** Shown after the label, muted. */
    count?: number | undefined;
    /** The current choice: filled with the accent color. */
    active?: boolean;
    /** 'add': a quiet "+ Something" chip at the end of the row. */
    variant?: 'default' | 'add';
    title?: string | undefined;
    ariaLabel?: string | undefined;
    disabled?: boolean;
    onclick: () => void;
  }

  let {
    label,
    count,
    active = false,
    variant = 'default',
    title,
    ariaLabel,
    disabled = false,
    onclick,
  }: Props = $props();
</script>

<button
  class="chip"
  class:active
  class:add={variant === 'add'}
  aria-pressed={variant === 'add' ? undefined : active}
  aria-label={ariaLabel}
  title={title ?? label}
  {disabled}
  {onclick}
>
  <span class="label">{label}</span>
  {#if count !== undefined}<span class="count">{count}</span>{/if}
</button>

<style>
  .chip {
    position: relative;
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 6px;
    max-width: 100%;
    min-height: 34px;
    padding: 0 12px;
    border: 0;
    border-radius: 999px;
    background: var(--bg-muted);
    color: var(--text);
    font: inherit;
    font-size: 0.875rem;
    cursor: pointer;
    transition:
      background-color 120ms ease,
      color 120ms ease;
  }

  /* Still a 44px touch target. */
  .chip::after {
    content: '';
    position: absolute;
    inset: -4px -2px;
  }

  .chip:hover {
    background: var(--selection);
  }

  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    color: var(--text-muted);
    font-size: 0.8125rem;
    font-variant-numeric: tabular-nums;
  }

  .chip.active {
    background: var(--accent);
    color: var(--on-accent);
  }

  .chip.active .count {
    color: inherit;
    opacity: 0.8;
  }

  .chip.add {
    background: none;
    color: var(--text-muted);
  }

  .chip.add:hover {
    background: var(--bg-muted);
    color: var(--text);
  }

  .chip:disabled {
    opacity: 0.6;
  }
</style>
