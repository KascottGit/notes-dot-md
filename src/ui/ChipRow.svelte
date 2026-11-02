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
    /** Centered (it still scrolls from the first chip when it doesn't fit). */
    center?: boolean;
    children: Snippet;
  }

  let { label, scroll = false, center = false, children }: Props = $props();
</script>

<div class="chips" class:scroll class:center role="group" aria-label={label}>
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

  /* Auto margins (not justify-content) so an overflowing row still starts at its first chip. */
  .chips.center > :global(:first-child) {
    margin-left: auto;
  }

  .chips.center > :global(:last-child) {
    margin-right: auto;
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
