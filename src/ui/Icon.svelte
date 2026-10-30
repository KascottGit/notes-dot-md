<!--
  The app's only icon set: every icon lives here, so the same action always
  looks the same. 24×24 line icons drawn with currentColor.
-->
<script lang="ts" module>
  /** Inner SVG markup per icon. Static strings written here, never user input. */
  export const ICONS = {
    // Actions
    pin: '<path d="M9 4h6l-1 6 3 3v2H7v-2l3-3zM12 15v5"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    logout: '<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 16l4-4-4-4M19 12H9"/>',
    expire: '<path d="M7 4h10M7 20h10M8 4c0 5 8 5 8 8s-8 3-8 8M16 4c0 5-8 5-8 8s8 3 8 8"/>',
    chevronDown: '<path d="M7 10l5 5 5-5"/>',
    sort: '<path d="M7 4v16M3.5 16.5L7 20l3.5-3.5M17 20V4M13.5 7.5L17 4l3.5 3.5"/>',
    // Format bar
    bold: '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" stroke-width="2.4"/>',
    italic: '<path d="M10 5h8M6 19h8M14 5l-4 14"/>',
    strike:
      '<path d="M4 12h16M16 7.5C15.4 6 14 5 12 5c-2.5 0-4 1.3-4 3 0 1.5 1 2.4 3 3M8 16.5c.6 1.5 2 2.5 4 2.5 2.5 0 4-1.3 4-3 0-.7-.2-1.3-.6-1.8"/>',
    code: '<path d="M9 7l-5 5 5 5M15 7l5 5-5 5"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    bullet:
      '<path d="M10 6h10M10 12h10M10 18h10"/><g fill="currentColor" stroke="none"><circle cx="5" cy="6" r="1.3"/><circle cx="5" cy="12" r="1.3"/><circle cx="5" cy="18" r="1.3"/></g>',
    number:
      '<path d="M10 6h10M10 12h10M10 18h10M4 5l1.5-1V9M3.5 14.5c.3-.8 1-1.2 1.7-1.2.9 0 1.5.6 1.5 1.3 0 1.2-3.2 2.4-3.2 3.9h3.4" stroke-width="1.5"/>',
    task: '<rect x="3.5" y="4" width="6" height="6" rx="1.2"/><path d="M4.7 16.6l1.5 1.5 2.8-3M13 7h7M13 17h7"/>',
    quote: '<path d="M5 6v12M10 8h9M10 12h9M10 16h6"/>',
    codeblock:
      '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M10 9.5l-2.5 2.5 2.5 2.5M14 9.5l2.5 2.5-2.5 2.5"/>',
    // Format bar: moving and nesting lines
    moveUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    moveDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    outdent: '<path d="M11 6h9M11 12h9M11 18h9M7.5 9l-3 3 3 3"/>',
    indent: '<path d="M11 6h9M11 12h9M11 18h9M4.5 9l3 3-3 3"/>',
  } as const;

  export type IconName = keyof typeof ICONS;
</script>

<script lang="ts">
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
