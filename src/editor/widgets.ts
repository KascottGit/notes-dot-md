/**
 * Small inline widgets that stand in for markdown markers. They only draw;
 * the document text underneath is never changed by rendering.
 */
import { foldEffect, foldedRanges, unfoldEffect } from '@codemirror/language';
import { EditorView, WidgetType } from '@codemirror/view';
import { toggleTaskAt } from './lists';

/** Replaces a `-`, `*` or `+` list marker. */
export class BulletWidget extends WidgetType {
  eq() {
    return true;
  }

  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-md-bullet';
    el.textContent = '•';
    el.setAttribute('aria-hidden', 'true');
    return el;
  }
}

/** Replaces `---` with a line. */
export class RuleWidget extends WidgetType {
  eq() {
    return true;
  }

  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-md-rule';
    el.setAttribute('aria-hidden', 'true');
    return el;
  }
}

/**
 * A clickable checkbox for `- [ ]` / `- [x]`. Toggling changes only the
 * character between the brackets. It never moves the cursor or focuses the
 * editor, so the on-screen keyboard stays closed on phones.
 */
export class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }

  eq(other: CheckboxWidget) {
    return other.checked === this.checked;
  }

  toDOM(view: EditorView) {
    const el = document.createElement('span');
    el.className = 'cm-md-checkbox';
    el.setAttribute('role', 'checkbox');
    el.setAttribute('aria-checked', String(this.checked));
    el.setAttribute('aria-label', this.checked ? 'Done' : 'Not done');
    el.contentEditable = 'false';

    const toggle = () => {
      if (view.state.readOnly) return;
      const spec = toggleTaskAt(view.state, view.posAtDOM(el));
      if (spec) view.dispatch({ ...spec, userEvent: 'input.toggle' });
    };

    // Mouse: keep focus and selection where they are.
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('click', (e) => {
      e.preventDefault();
      toggle();
    });

    // Touch: handle the tap ourselves so the browser doesn't place the caret
    // (which would open the keyboard). Ignore taps that turned into scrolls.
    let start: { x: number; y: number } | null = null;
    el.addEventListener(
      'touchstart',
      (e) => {
        const t = e.touches[0];
        start = t ? { x: t.clientX, y: t.clientY } : null;
      },
      { passive: true },
    );
    el.addEventListener(
      'touchend',
      (e) => {
        const t = e.changedTouches[0];
        const moved = !start || !t || Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10;
        start = null;
        if (moved) return;
        e.preventDefault(); // Also stops the emulated mouse events and the click.
        toggle();
      },
      { passive: false },
    );
    return el;
  }

  /** CodeMirror leaves events on the checkbox to the handlers above. */
  ignoreEvent() {
    return true;
  }
}

/** A small toggle that folds or unfolds the frontmatter block. */
export class FoldToggleWidget extends WidgetType {
  constructor(
    readonly from: number,
    readonly to: number,
    readonly folded: boolean,
  ) {
    super();
  }

  eq(other: FoldToggleWidget) {
    return other.folded === this.folded && other.from === this.from && other.to === this.to;
  }

  toDOM(view: EditorView) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'cm-md-fold';
    el.textContent = this.folded ? '▸ frontmatter' : '▾';
    el.setAttribute('aria-label', this.folded ? 'Show frontmatter' : 'Hide frontmatter');
    el.setAttribute('aria-expanded', String(!this.folded));
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const range = { from: this.from, to: this.to };
      let folded = false;
      foldedRanges(view.state).between(range.from, range.to, (from, to) => {
        if (from === range.from && to === range.to) folded = true;
      });
      view.dispatch({ effects: (folded ? unfoldEffect : foldEffect).of(range) });
    });
    return el;
  }

  ignoreEvent() {
    return true;
  }
}
