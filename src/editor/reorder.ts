/**
 * Reordering list items by touch: touch and hold an item's marker (checkbox,
 * bullet or number), then drag it up or down among the items of its list.
 * The item moves with its sub-items (`moveListItem` in lists.ts).
 *
 * While dragging, a floating copy follows the finger and the item itself
 * (dimmed) moves through the list as the copy passes its neighbours, like
 * Apple Notes. Those steps stay out of the undo history; the drop records
 * the whole move as one undo step.
 *
 * Mouse and keyboard are unchanged: on desktop, Alt+↑/↓ moves lines.
 */
import {
  Annotation,
  StateEffect,
  StateField,
  Transaction,
  type Range,
  type TransactionSpec,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { listMarkerAt, listSiblings, moveListItem } from './lists';

/** How long to hold before the item lifts. Shorter than iOS's own long press. */
const HOLD_MS = 350;
/** Moving further than this before the item lifts means scrolling instead. */
const MOVE_TOLERANCE = 8;
/** Extra room around a marker that still counts as touching it (px). */
const HIT_LEFT = 22;
const HIT_RIGHT = 8;
const HIT_Y = 8;
/** Dragging this close to the top or bottom edge scrolls the note. */
const SCROLL_EDGE = 56;
const SCROLL_SPEED = 14; // px per frame at the very edge

/** Marks the steps of a drag, so they don't cancel it. */
const dragStep = Annotation.define<boolean>();

/** Dims the lines of the item being dragged (start of first line, start of last line). */
const setSource = StateEffect.define<{ from: number; to: number } | null>();
const sourceLine = Decoration.line({ class: 'cm-md-drag-source' });

const sourceField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setSource)) continue;
      const range = effect.value;
      if (!range) {
        value = Decoration.none;
        continue;
      }
      const { doc } = tr.state;
      const lines: Range<Decoration>[] = [];
      const last = doc.lineAt(range.to).number;
      for (let n = doc.lineAt(range.from).number; n <= last; n++) {
        lines.push(sourceLine.range(doc.line(n).from));
      }
      value = Decoration.set(lines);
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

interface Pending {
  x: number;
  y: number;
  /** Start of the touched list item. */
  item: number;
  timer: number;
}

interface Drag {
  /** Where the dragged item starts now (it moves during the drag). */
  item: number;
  /** Its place among its siblings when the drag started, and now. */
  origin: number;
  index: number;
  /** Finger position (client coordinates). */
  y: number;
  /** Ghost top minus finger y, so the ghost keeps its place under the finger. */
  offset: number;
  ghost: HTMLElement;
  frame: number;
}

class Reorder {
  pending: Pending | null = null;
  drag: Drag | null = null;

  constructor(readonly view: EditorView) {
    // Capture phase, so a drag is handled before the checkbox's own tap handling.
    const dom = view.dom;
    dom.addEventListener('touchstart', this.onStart, { capture: true, passive: true });
    dom.addEventListener('touchmove', this.onMove, { capture: true, passive: false });
    dom.addEventListener('touchend', this.onEnd, { capture: true, passive: false });
    dom.addEventListener('touchcancel', this.onCancel, { capture: true });
    view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });
  }

  update(update: ViewUpdate) {
    // The text changed under the drag (e.g. a newer version loaded): give up.
    const foreign = update.transactions.some((tr) => tr.docChanged && !tr.annotation(dragStep));
    if (foreign && this.drag) {
      this.cleanUp();
      setTimeout(() => this.view.dispatch({ effects: setSource.of(null) }));
    }
  }

  destroy() {
    const dom = this.view.dom;
    dom.removeEventListener('touchstart', this.onStart, { capture: true });
    dom.removeEventListener('touchmove', this.onMove, { capture: true });
    dom.removeEventListener('touchend', this.onEnd, { capture: true });
    dom.removeEventListener('touchcancel', this.onCancel, { capture: true });
    this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
    this.cancelPending();
    this.cleanUp();
  }

  onStart = (event: TouchEvent) => {
    this.cancelPending();
    const touch = event.touches[0];
    if (this.drag || event.touches.length !== 1 || !touch || this.view.state.readOnly) return;
    const item = this.hit(touch.clientX, touch.clientY);
    if (item === null) return;
    this.pending = {
      x: touch.clientX,
      y: touch.clientY,
      item,
      timer: window.setTimeout(() => this.lift(), HOLD_MS),
    };
  };

  onMove = (event: TouchEvent) => {
    const touch = event.touches[0];
    if (!touch) return;
    if (this.drag) {
      event.preventDefault(); // No scrolling while dragging.
      event.stopPropagation();
      this.drag.y = touch.clientY;
      this.place();
      return;
    }
    const p = this.pending;
    if (p && Math.hypot(touch.clientX - p.x, touch.clientY - p.y) > MOVE_TOLERANCE) {
      this.cancelPending();
    }
  };

  onEnd = (event: TouchEvent) => {
    this.cancelPending();
    if (!this.drag) return;
    // No tap after a drag: don't toggle the checkbox or place the caret.
    event.preventDefault();
    event.stopPropagation();
    this.drop(true);
  };

  onCancel = () => {
    this.cancelPending();
    if (this.drag) this.drop(false);
  };

  onScroll = () => {
    this.cancelPending();
  };

  cancelPending() {
    if (this.pending) clearTimeout(this.pending.timer);
    this.pending = null;
  }

  /** The list item whose marker is at x, y (client coordinates), if any. */
  hit(x: number, y: number): number | null {
    const { view } = this;
    const pos = view.posAtCoords({ x, y });
    if (pos === null) return null;
    const mark = listMarkerAt(view.state, view.state.doc.lineAt(pos).from);
    if (!mark) return null;
    const start = view.coordsAtPos(mark.from, 1);
    const end = view.coordsAtPos(mark.to, -1);
    if (!start || !end) return null;
    const right = Math.max(start.right, end.right);
    if (y < start.top - HIT_Y || y > start.bottom + HIT_Y) return null;
    if (x < start.left - HIT_LEFT || x > right + HIT_RIGHT) return null;
    return mark.item;
  }

  /** The held item lifts: show the floating copy and start following the finger. */
  lift() {
    const p = this.pending;
    this.pending = null;
    const { view } = this;
    if (!p || view.state.readOnly) return;
    const siblings = listSiblings(view.state, p.item);
    if (!siblings || siblings.blocks.length < 2) return;
    const block = siblings.blocks[siblings.index]!;
    const { doc } = view.state;

    const lineEls = new Map<number, HTMLElement>();
    for (const el of view.contentDOM.querySelectorAll<HTMLElement>(':scope > .cm-line')) {
      lineEls.set(view.posAtDOM(el, 0), el);
    }
    const ghost = document.createElement('div');
    ghost.className = 'cm-md-drag-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    let first: DOMRect | null = null;
    for (let n = block.from; n <= block.to; n++) {
      const el = lineEls.get(doc.line(n).from);
      if (!el) continue;
      first ??= el.getBoundingClientRect();
      ghost.appendChild(el.cloneNode(true));
    }
    if (!first) return;

    const box = view.dom.getBoundingClientRect();
    ghost.style.left = `${first.left - box.left}px`;
    ghost.style.width = `${first.width}px`;
    view.dom.append(ghost);
    view.dom.classList.add('cm-md-dragging');

    this.drag = {
      item: p.item,
      origin: siblings.index,
      index: siblings.index,
      y: p.y,
      offset: first.top - p.y,
      ghost,
      frame: requestAnimationFrame(this.frame),
    };
    view.dispatch({
      effects: setSource.of({ from: doc.line(block.from).from, to: doc.line(block.to).from }),
    });
    if ('vibrate' in navigator) navigator.vibrate(10);
    this.place();
  }

  /**
   * Move the ghost to the finger. When its middle passes the middle of the
   * item above or below, the dragged item swaps places with that item.
   */
  place() {
    const d = this.drag;
    if (!d) return;
    const { view } = this;
    const box = view.dom.getBoundingClientRect();
    const ghostTop = d.y + d.offset;
    d.ghost.style.top = `${ghostTop - box.top}px`;

    const siblings = listSiblings(view.state, d.item);
    if (!siblings) return;
    const { blocks, index } = siblings;
    const { doc } = view.state;
    // Document coordinates (CodeMirror's height map).
    const middle = ghostTop + d.ghost.offsetHeight / 2 - view.documentTop;
    const center = (k: number) =>
      (view.lineBlockAt(doc.line(blocks[k]!.from).from).top +
        view.lineBlockAt(doc.line(blocks[k]!.to).from).bottom) /
      2;
    let slot = index;
    if (index > 0 && middle < center(index - 1)) slot = index - 1;
    else if (index < blocks.length - 1 && middle > center(index + 1)) slot = index + 2;
    if (slot === index) return;
    const move = moveListItem(view.state, d.item, slot);
    if (!move) return;
    d.item = move.item;
    d.index = slot > index ? index + 1 : index - 1;
    view.dispatch(this.step(move.spec, move.lines));
  }

  /** A drag step: shown and saved like any edit, but not an undo step of its own. */
  step(spec: TransactionSpec, lines: { from: number; to: number } | null): TransactionSpec {
    return {
      ...spec,
      effects: setSource.of(lines),
      annotations: [Transaction.addToHistory.of(false), dragStep.of(true)],
    };
  }

  /** Each frame: scroll the note while the finger is near its top or bottom edge. */
  frame = () => {
    const d = this.drag;
    if (!d) return;
    const scroller = this.view.scrollDOM;
    const rect = scroller.getBoundingClientRect();
    // The on-screen keyboard can cover the bottom of the editor.
    const vv = window.visualViewport;
    const top = Math.max(rect.top, vv ? vv.offsetTop : rect.top);
    const bottom = Math.min(rect.bottom, vv ? vv.offsetTop + vv.height : rect.bottom);
    let speed = 0;
    if (d.y < top + SCROLL_EDGE) speed = -Math.min(1, (top + SCROLL_EDGE - d.y) / SCROLL_EDGE);
    else if (d.y > bottom - SCROLL_EDGE) {
      speed = Math.min(1, (d.y - (bottom - SCROLL_EDGE)) / SCROLL_EDGE);
    }
    if (speed) scroller.scrollTop += speed * SCROLL_SPEED;
    // Also catches up after fast moves, one step per frame.
    this.place();
    if (this.drag === d) d.frame = requestAnimationFrame(this.frame);
  };

  /** Remove the drag visuals (but not the dimmed lines, which need a dispatch). */
  cleanUp(): Drag | null {
    const d = this.drag;
    this.drag = null;
    if (!d) return null;
    cancelAnimationFrame(d.frame);
    d.ghost.remove();
    this.view.dom.classList.remove('cm-md-dragging');
    return d;
  }

  /**
   * End the drag. To make the whole drag one undo step, put the item back
   * where it started (outside the history) and move it there in one go.
   * Without `keep`, the item just goes back.
   */
  drop(keep: boolean) {
    const d = this.cleanUp();
    if (!d) return;
    const { view } = this;
    const effects = setSource.of(null);
    const slotFor = (target: number, from: number) => (target < from ? target : target + 1);
    const back =
      d.index === d.origin ? null : moveListItem(view.state, d.item, slotFor(d.origin, d.index));
    if (!back) {
      view.dispatch({ effects });
      return;
    }
    if (!keep) {
      view.dispatch(this.step(back.spec, null));
      return;
    }
    view.dispatch(this.step(back.spec, back.lines));
    const final = moveListItem(view.state, back.item, slotFor(d.index, d.origin));
    view.dispatch(final ? { ...final.spec, effects } : { effects });
  }
}

const reorderPlugin = ViewPlugin.fromClass(Reorder);

const reorderTheme = EditorView.theme({
  // Markers are drag handles: no text selection or callout when held.
  '.cm-md-checkbox, .cm-md-bullet': {
    WebkitTouchCallout: 'none',
    WebkitUserSelect: 'none',
    userSelect: 'none',
  },
  '&.cm-md-dragging .cm-content': {
    WebkitTouchCallout: 'none',
    WebkitUserSelect: 'none',
    userSelect: 'none',
  },
  '.cm-line.cm-md-drag-source': { opacity: '0.3' },
  '.cm-md-drag-ghost': {
    position: 'absolute',
    zIndex: '5',
    pointerEvents: 'none',
    padding: '2px 0',
    margin: '-2px 0 0',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    backgroundColor: 'var(--bg-raised)',
    color: 'var(--text)',
    boxShadow: '0 6px 24px rgb(0 0 0 / 18%)',
    fontFamily: 'var(--font-body)',
    lineHeight: '1.65',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    overflowWrap: 'anywhere',
  },
});

export function listReorder() {
  return [sourceField, reorderPlugin, reorderTheme];
}
