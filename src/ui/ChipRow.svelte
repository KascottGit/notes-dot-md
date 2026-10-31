<!--
  A row of Chips. On desktop it wraps; on phones (or with `scroll`) it is one
  line that scrolls sideways, so what is below it starts higher.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    label: string;
    /** Always one sideways-scrolling line, also on desktop. */
    scroll?: boolean;
    children: Snippet;
  }

  let { label, scroll = false, children }: Props = $props();
</script>

<div class="chips" class:scroll role="group" aria-label={label}>
  {@render children()}
</div>

<style>
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 0 8px 8px;
  }

  .chips.scroll {
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .chips::-webkit-scrollbar {
    display: none;
  }

  .chips > :global(.chip) {
    max-width: 70vw;
  }

  @media (max-width: 899px) {
    .chips {
      flex-wrap: nowrap;
      overflow-x: auto;
      scrollbar-width: none;
    }
  }
</style>
