/**
 * Svelte action: keeps the element exactly covering the visible part of the
 * screen, like a native notes app: while the on-screen keyboard is open, the
 * header and format bar stay at the top and the note area shrinks to fit
 * above the keyboard.
 *
 * Android Chrome already resizes the page for the keyboard
 * (interactive-widget=resizes-content). iPhone Safari lays the keyboard over
 * the page and pans the page to show the caret; this sizes the element to the
 * visual viewport and follows its offset instead.
 *
 * `onResize` runs after every change, so the editor can scroll the cursor
 * back into view; without that, the line you tapped can end up hidden.
 */
export function fitVisualViewport(node: HTMLElement, options: { onResize?: () => void } = {}) {
  const viewport = window.visualViewport;
  if (!viewport) return {};
  let onResize = options.onResize;
  let frame = 0;

  const update = () => {
    const keyboardOpen = window.innerHeight - viewport.height > 1;
    node.style.height = keyboardOpen ? `${viewport.height}px` : '';
    node.style.transform = viewport.offsetTop > 0 ? `translateY(${viewport.offsetTop}px)` : '';
    // Undo any page scroll; the note list and editor scroll inside the app.
    if (window.scrollY !== 0) window.scrollTo(0, 0);
    // Let the layout settle, then keep the cursor visible.
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => onResize?.());
  };

  update();
  viewport.addEventListener('resize', update);
  viewport.addEventListener('scroll', update);
  return {
    update(next: { onResize?: () => void } = {}) {
      onResize = next.onResize;
    },
    destroy() {
      cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      node.style.height = '';
      node.style.transform = '';
    },
  };
}
