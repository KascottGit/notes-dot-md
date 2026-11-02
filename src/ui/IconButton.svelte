<!-- A 44×44 icon-only button. Use it for every icon action (pin, delete, back...). -->
<script lang="ts">
  import Icon from './Icon.svelte';
  import type { IconName } from './icons';

  interface Props {
    icon: IconName;
    /** Read by screen readers; also the tooltip unless `title` is given. */
    label: string;
    title?: string;
    /** For toggles like pin. */
    pressed?: boolean;
    disabled?: boolean;
    /** A number after the icon, e.g. how many images a card has (not shown when 0). */
    count?: number;
    onclick: () => void;
  }

  let { icon, label, title, pressed, disabled = false, count = 0, onclick }: Props = $props();
</script>

<button
  class="icon-button"
  class:on={pressed}
  aria-label={label}
  aria-pressed={pressed}
  title={title ?? label}
  {disabled}
  {onclick}
>
  <Icon name={icon} filled={pressed} />
  {#if count > 0}<span class="count">{count}</span>{/if}
</button>

<style>
  .icon-button {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    gap: 2px;
    min-width: 44px;
    height: 44px;
    padding: 0 6px;
    border: 0;
    border-radius: 8px;
    background: none;
    color: var(--text-muted);
    cursor: pointer;
    transition:
      background-color 120ms ease,
      color 120ms ease;
  }

  .icon-button:hover:not(:disabled) {
    background: var(--bg-muted);
    color: var(--text);
  }

  .count {
    font-size: 0.8125rem;
    font-variant-numeric: tabular-nums;
  }

  .icon-button.on {
    color: var(--pin);
  }

  .icon-button:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
