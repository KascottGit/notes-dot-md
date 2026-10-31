<!-- Draws an icon from the app's one icon set (icons.ts). -->
<script lang="ts">
  import { ICONS, type IconName } from './icons';

  interface Props {
    name: IconName;
    size?: number;
    /** Filled instead of outlined, e.g. an active pin. */
    filled?: boolean;
  }

  let { name, size = 20, filled = false }: Props = $props();
</script>

<svg
  viewBox="0 0 24 24"
  width={size}
  height={size}
  aria-hidden="true"
  fill={filled ? 'currentColor' : 'none'}
  stroke="currentColor"
  stroke-width="1.8"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- static markup from ICONS above -->
  {@html ICONS[name]}
</svg>

<style>
  svg {
    flex: none;
  }
</style>
