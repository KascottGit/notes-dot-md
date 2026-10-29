/**
 * Svelte action: keeps the element exactly covering the visible part of the
 * screen, so the note header and format bar stay at the top while the
 * on-screen keyboard is open.
 *
 * Android Chrome resizes the page for the keyboard by itself
 * (interactive-widget=resizes-content). iPhone Safari lays the keyboard over
 * the page and may pan the page up to show the caret; this undoes that by
 * sizing the element to the visual viewport and following its offset.
 */
export function fitVisualViewport(node: HTMLElement) {
  const viewport = window.visualViewport;
  if (!viewport) return {};

  const update = () => {
    const keyboardOpen = window.innerHeight - viewport.height > 1;
    node.style.height = keyboardOpen ? `${viewport.height}px` : '';
    node.style.transform = viewport.offsetTop > 0 ? `translateY(${viewport.offsetTop}px)` : '';
    // Undo any page scroll; the list and editor scroll inside the app.
    if (window.scrollY !== 0) window.scrollTo(0, 0);
  };

  update();
  viewport.addEventListener('resize', update);
  viewport.addEventListener('scroll', update);
  return {
    destroy() {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      node.style.height = '';
      node.style.transform = '';
    },
  };
}
