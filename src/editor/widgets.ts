/**
 * Small inline widgets that stand in for markdown markers. They only draw;
 * the document text underneath is never changed by rendering.
 */
import { foldEffect, foldedRanges, unfoldEffect } from '@codemirror/language';
import { EditorView, WidgetType } from '@codemirror/view';
import { toggleTaskAt } from './lists';
import { isLoadable, isOpenable, type Inline, type Table } from './markdown';

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

/** The character an entity like `&amp;` stands for. Parsing HTML text this way runs nothing. */
function decodeEntity(entity: string): string {
  const doc = new DOMParser().parseFromString(entity, 'text/html');
  return doc.documentElement.textContent ?? entity;
}

/** An image, or its alt text when it has no loadable source or fails to load. */
function imageElement(src: string | null, alt: string, view: EditorView): HTMLElement {
  const placeholder = () => {
    const el = document.createElement('span');
    el.className = 'cm-md-image-missing';
    el.textContent = alt || src || 'Image';
    if (src) el.title = src;
    return el;
  };
  if (!isLoadable(src)) return placeholder();
  const img = document.createElement('img');
  img.className = 'cm-md-image';
  img.src = src;
  img.alt = alt;
  if (alt) img.title = alt;
  img.referrerPolicy = 'no-referrer';
  img.loading = 'lazy';
  img.decoding = 'async';
  // The line gets taller once the image arrives.
  img.addEventListener('load', () => view.requestMeasure());
  img.addEventListener('error', () => {
    img.replaceWith(placeholder());
    view.requestMeasure();
  });
  return img;
}

/** Draw inline content as elements. Text always goes in as text, never as HTML. */
function renderInline(nodes: Inline[], parent: HTMLElement, view: EditorView) {
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        parent.append(node.text);
        break;
      case 'entity':
        parent.append(decodeEntity(node.text));
        break;
      case 'code': {
        const el = document.createElement('code');
        el.className = 'cm-md-code';
        el.textContent = node.text;
        parent.append(el);
        break;
      }
      case 'image':
        parent.append(imageElement(node.src, node.alt, view));
        break;
      case 'link': {
        // Same as links in the text: tap or Ctrl+click opens them (livePreview.ts).
        const el = document.createElement('span');
        el.className = 'cm-md-link cm-md-link-rendered';
        if (isOpenable(node.href)) el.dataset['href'] = node.href;
        renderInline(node.children, el, view);
        parent.append(el);
        break;
      }
      default: {
        const el = document.createElement(
          node.type === 'strong' ? 'strong' : node.type === 'em' ? 'em' : 's',
        );
        renderInline(node.children, el, view);
        parent.append(el);
      }
    }
  }
}

/** Replaces `![alt](url)`. Tapping it puts the cursor there, which shows the source. */
export class ImageWidget extends WidgetType {
  constructor(
    readonly src: string | null,
    readonly alt: string,
  ) {
    super();
  }

  eq(other: ImageWidget) {
    return other.src === this.src && other.alt === this.alt;
  }

  toDOM(view: EditorView) {
    return imageElement(this.src, this.alt, view);
  }

  /** Let the editor handle taps, so they place the cursor. */
  ignoreEvent() {
    return false;
  }
}

/** Replaces an entity like `&copy;` with its character. */
export class EntityWidget extends WidgetType {
  constructor(readonly entity: string) {
    super();
  }

  eq(other: EntityWidget) {
    return other.entity === this.entity;
  }

  toDOM() {
    const el = document.createElement('span');
    el.textContent = decodeEntity(this.entity);
    return el;
  }
}

/**
 * Replaces a whole GFM table while the cursor is outside it. Tapping it puts
 * the cursor in the table, which shows its text for editing.
 */
export class TableWidget extends WidgetType {
  /** Compared in `eq`, so an unchanged table keeps its DOM. */
  private readonly key: string;

  constructor(readonly table: Table) {
    super();
    this.key = JSON.stringify(table);
  }

  eq(other: TableWidget) {
    return other.key === this.key;
  }

  get estimatedHeight() {
    return (this.table.rows.length + 1) * 34;
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement('div');
    wrap.className = 'cm-md-table-widget';
    const table = document.createElement('table');
    const row = (cells: Inline[][], tag: 'th' | 'td') => {
      const tr = document.createElement('tr');
      cells.forEach((cell, i) => {
        const el = document.createElement(tag);
        const align = this.table.align[i];
        if (align) el.style.textAlign = align;
        renderInline(cell, el, view);
        tr.append(el);
      });
      return tr;
    };
    const head = document.createElement('thead');
    head.append(row(this.table.head, 'th'));
    const body = document.createElement('tbody');
    for (const cells of this.table.rows) body.append(row(cells, 'td'));
    table.append(head, body);
    wrap.append(table);
    return wrap;
  }

  /** Let the editor handle taps (placing the cursor) and link taps (livePreview.ts). */
  ignoreEvent() {
    return false;
  }
}
