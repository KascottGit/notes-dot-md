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
    onclick: () => void;
  }

  let { icon, label, title, pressed, disabled = false, onclick }: Props = $props();
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
</button>

<style>
  .icon-button {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
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

  .icon-button.on {
    color: var(--pin);
  }

  .icon-button:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
