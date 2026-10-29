/**
 * Svelte action: keeps `--keyboard-inset` on the element set to how much of
 * the bottom of the window the on-screen keyboard covers.
 *
 * Android Chrome resizes the page for the keyboard (interactive-widget=
 * resizes-content), so this stays 0 there. iPhone Safari lays the keyboard
 * over the page instead; the visual viewport tells us by how much.
 */
export function keyboardInset(node: HTMLElement) {
  const viewport = window.visualViewport;
  if (!viewport) return {};

  const update = () => {
    const covered = window.innerHeight - (viewport.offsetTop + viewport.height);
    node.style.setProperty('--keyboard-inset', `${Math.max(0, Math.round(covered))}px`);
  };

  update();
  viewport.addEventListener('resize', update);
  viewport.addEventListener('scroll', update);
  return {
    destroy() {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    },
  };
}
