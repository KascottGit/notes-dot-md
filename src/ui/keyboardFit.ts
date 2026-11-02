/**
 * Svelte action for iPhone Safari's on-screen keyboard: keeps the header and
 * format bar at the top and shrinks the app to the space above the keyboard,
 * with the line you tapped in view. Like Apple Notes.
 *
 * Safari lays the keyboard over the page and shifts the whole page up to
 * show the caret, taking the header with it. Earlier tries followed every
 * shift (moving the app along) and fought Safari, which flickered. This one
 * never follows Safari; it waits until things have settled, then in one go:
 * sizes the app to the visible area, scrolls the caret into view inside the
 * note, and undoes Safari's shift. The caret is then already visible, so
 * Safari has nothing to correct and nothing loops.
 *
 * The keyboard's height is remembered, so from the second time on the app
 * shrinks the moment an editable is focused, before the keyboard arrives,
 * and Safari has no reason to shift the page at all.
 *
 * Android Chrome resizes the page itself (`interactive-widget=resizes-content`),
 * and desktops have no on-screen keyboard; both leave this idle.
 */
import { EditorView } from '@codemirror/view';
import { safeLocalStorage } from '../store/storage';

/** Less than this is a browser bar, not a keyboard. */
const MIN_KEYBOARD = 120;
/** Wait this long after the last viewport change before fitting. */
const SETTLE_MS = 120;
/** Fit anyway this long after focus moves (no keyboard came, e.g. a hardware keyboard). */
const FALLBACK_MS = 700;
/** Room kept between the caret and the keyboard. */
const MARGIN = 32;
const STORAGE_KEY = 'mdnotes.keyboardHeight';

/** How much of the window the keyboard covers (0 when it's closed). */
export function keyboardHeight(windowHeight: number, viewportHeight: number): number {
  const covered = Math.round(windowHeight - viewportHeight);
  return covered >= MIN_KEYBOARD ? covered : 0;
}

/**
 * How far to scroll a box so a caret inside it is visible, `margin` away
 * from its edges: positive scrolls down, negative up, 0 when already visible.
 */
export function revealDelta(
  caret: { top: number; bottom: number },
  box: { top: number; bottom: number },
  margin = MARGIN,
): number {
  const room = box.bottom - box.top;
  const m = Math.min(margin, Math.max(0, (room - (caret.bottom - caret.top)) / 2));
  if (caret.bottom > box.bottom - m) return caret.bottom - (box.bottom - m);
  if (caret.top < box.top + m) return caret.top - (box.top + m);
  return 0;
}

function isEditable(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly;
  if (el instanceof HTMLInputElement) {
    return !el.readOnly && !['button', 'checkbox', 'radio', 'submit', 'file'].includes(el.type);
  }
  return el.isContentEditable;
}

/**
 * Where the caret is on screen. The browser's own selection comes first: it
 * is up to date right after a tap, while the editor's state follows a moment
 * later.
 */
function caretRect(active: HTMLElement): { top: number; bottom: number } | null {
  const selection = window.getSelection();
  const focus = selection?.focusNode;
  if (active.isContentEditable && focus && active.contains(focus)) {
    const range = document.createRange();
    range.setStart(focus, selection.focusOffset);
    const rect = range.getBoundingClientRect();
    if (rect.height > 0) return rect;
    // An empty line has no caret box; use the line itself.
    const el = focus instanceof Element ? focus : focus.parentElement;
    const line = el?.closest('.cm-line') ?? el;
    const lineRect = line?.getBoundingClientRect();
    if (lineRect && lineRect.height > 0) return lineRect;
  }
  const editor = active.closest<HTMLElement>('.cm-editor');
  const view = editor ? EditorView.findFromDOM(editor) : null;
  const coords = view?.coordsAtPos(view.state.selection.main.head);
  return coords ?? active.getBoundingClientRect();
}

/** The nearest ancestor that scrolls vertically. */
function scroller(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    }
  }
  return null;
}

function orientation(): string {
  return window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';
}

function remembered(): number {
  try {
    return Number(safeLocalStorage()?.getItem(`${STORAGE_KEY}.${orientation()}`)) || 0;
  } catch {
    return 0;
  }
}

function remember(height: number) {
  try {
    safeLocalStorage()?.setItem(`${STORAGE_KEY}.${orientation()}`, String(height));
  } catch {
    // Only makes the next time smoother.
  }
}

export function fitKeyboard(node: HTMLElement) {
  const viewport = window.visualViewport;
  if (!viewport) return {};
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;
  /** Until when caret moves count as the tap placing it (just after focus). */
  let placingUntil = 0;

  const setHeight = (height: number | null) => {
    const value = height ? `${Math.round(height)}px` : '';
    if (node.style.height !== value) node.style.height = value;
  };

  /** Scroll the focused editable's caret into view, inside the app. */
  const reveal = () => {
    const active = document.activeElement;
    if (!isEditable(active)) return;
    const caret = caretRect(active);
    const box = scroller(active);
    if (!caret || !box) return;
    const outer = box.getBoundingClientRect();
    const app = node.getBoundingClientRect();
    const delta = revealDelta(caret, {
      top: outer.top,
      bottom: Math.min(outer.bottom, app.bottom),
    });
    if (delta) box.scrollTop += delta;
  };

  /** The keyboard has settled: fit the app to it, show the caret, undo Safari's shift. */
  const settle = () => {
    clearTimeout(settleTimer);
    clearTimeout(fallbackTimer);
    if (viewport.scale > 1.01) return; // Zoomed in (zoom is off, but just in case).
    const keyboard = keyboardHeight(window.innerHeight, viewport.height);
    if (keyboard) remember(keyboard);
    setHeight(keyboard ? viewport.height : null);
    if (keyboard) reveal();
    if (window.scrollY !== 0 || viewport.offsetTop !== 0) window.scrollTo(0, 0);
  };

  const onViewportChange = () => {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, SETTLE_MS);
  };

  const onFocusIn = (event: FocusEvent) => {
    if (!isEditable(event.target as Element)) return;
    clearTimeout(fallbackTimer);
    fallbackTimer = setTimeout(settle, FALLBACK_MS);
    const known = remembered();
    const open = keyboardHeight(window.innerHeight, viewport.height) > 0;
    // The keyboard is coming: make room for it now, before Safari moves the page.
    if (known && !open) {
      setHeight(window.innerHeight - known);
      reveal();
    }
    // The tap places the caret just after focus; follow it for a moment.
    if (known || open) {
      placingUntil = Date.now() + 600;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(reveal);
    }
  };

  const onSelectionChange = () => {
    if (Date.now() > placingUntil) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(reveal);
  };

  const onFocusOut = () => {
    clearTimeout(fallbackTimer);
    fallbackTimer = setTimeout(settle, FALLBACK_MS);
  };

  viewport.addEventListener('resize', onViewportChange);
  viewport.addEventListener('scroll', onViewportChange);
  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('focusout', onFocusOut);
  document.addEventListener('selectionchange', onSelectionChange);
  return {
    destroy() {
      clearTimeout(settleTimer);
      clearTimeout(fallbackTimer);
      cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', onViewportChange);
      viewport.removeEventListener('scroll', onViewportChange);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('selectionchange', onSelectionChange);
      setHeight(null);
    },
  };
}
