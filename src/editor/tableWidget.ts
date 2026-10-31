/**
 * Tables that stay tables while editing, like Obsidian. The whole table is
 * one widget; tapping a cell turns it into a small text box with that cell's
 * markdown. Every keystroke writes the cell back into the note's lines
 * (tableEdit.ts), and the widget patches its DOM in place so the text box
 * keeps focus. "+" bars add a row or column; while a cell is being edited,
 * a tool row adds and deletes rows and columns, or shows the table as text.
 *
 * Keys in a cell: Tab / Shift+Tab next / previous cell (a new row after the
 * last), Enter the cell below (a new row at the bottom), ↑ / ↓ the row above
 * or below (out of the table at the edges), Escape back to the text.
 */
import { StateEffect, type ChangeSpec } from '@codemirror/state';
import { EditorView, ViewPlugin, WidgetType, type ViewUpdate } from '@codemirror/view';
import { iconSvg, type IconName } from '../ui/icons';
import { isOpenable, type Table } from './markdown';
import {
  cellText,
  columnAlign,
  deleteColumn,
  editCell,
  deleteRow,
  insertColumn,
  insertRow,
  setCell,
  setColumnAlign,
  tableLayoutAt,
  type ColumnAlign,
  type TableLayout,
} from './tableEdit';
import { renderInline } from './widgets';

/** Show a table's lines (from–to) as markdown text until the cursor leaves them. */
export const showTableText = StateEffect.define<{ from: number; to: number }>();

/** The widget each table element was last drawn from (widgets get replaced on every edit). */
const drawnFrom = new WeakMap<HTMLElement, TableWidget>();
/** Updates each table's tool row to the cell being edited. */
const refreshTools = new WeakMap<HTMLElement, () => void>();

export class TableWidget extends WidgetType {
  /** Compared in `eq`, so an unchanged table keeps its DOM. */
  private readonly key: string;

  constructor(
    readonly table: Table,
    readonly editable: boolean,
  ) {
    super();
    this.key = `${editable}:${JSON.stringify(table)}`;
  }

  eq(other: TableWidget) {
    return other.key === this.key;
  }

  get estimatedHeight() {
    return (this.table.rows.length + 1) * 34 + 12;
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement('div');
    wrap.className = 'cm-md-table-widget';
    wrap.classList.toggle('editable', this.editable);
    const grid = element('div', 'cm-md-table-grid');
    const scroll = element('div', 'cm-md-table-scroll');
    const table = document.createElement('table');
    table.append(document.createElement('thead'), document.createElement('tbody'));
    scroll.append(table);
    grid.append(scroll);
    wrap.append(grid);
    if (this.editable) {
      grid.append(
        addButton(view, wrap, 'cm-md-table-add-col', 'Add column', 'plus'),
        addButton(view, wrap, 'cm-md-table-add-row', 'Add row', 'plus'),
      );
      wrap.append(tools(view, wrap));
    }
    drawnFrom.set(wrap, this);
    fill(wrap, this, view);
    listen(wrap, view);
    return wrap;
  }

  /** Update the table in place, keeping the cell that is being edited as it is. */
  updateDOM(dom: HTMLElement, view: EditorView) {
    const old = drawnFrom.get(dom);
    if (!old || old.editable !== this.editable) return false;
    drawnFrom.set(dom, this);
    fill(dom, this, view);
    return true;
  }

  /** The widget handles its own clicks, taps and typing. */
  ignoreEvent() {
    return true;
  }
}

function element(tag: string, className: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  return el;
}

/** The cell with the text box in it, if any. */
function editingCell(wrap: HTMLElement): HTMLTableCellElement | null {
  return wrap.querySelector('.cm-md-cell-input')?.closest('th, td') ?? null;
}

const position = (cell: HTMLElement) => ({
  row: Number(cell.dataset['row']),
  col: Number(cell.dataset['col']),
});

/** Make the table's cells match the widget's table, leaving the edited cell alone. */
function fill(wrap: HTMLElement, widget: TableWidget, view: EditorView) {
  const { table } = widget;
  const columns = table.head.length;
  const active = editingCell(wrap);
  const syncRow = (
    tr: HTMLTableRowElement,
    cells: Table['head'],
    row: number,
    tag: 'th' | 'td',
  ) => {
    for (let col = 0; col < columns; col++) {
      let cell = tr.children[col] as HTMLTableCellElement | undefined;
      if (!cell) tr.append((cell = document.createElement(tag)));
      cell.dataset['row'] = String(row);
      cell.dataset['col'] = String(col);
      cell.style.textAlign = table.align[col] ?? '';
      if (cell === active) continue;
      cell.replaceChildren();
      renderInline(cells[col] ?? [], cell, view);
    }
    while (tr.children.length > columns) tr.lastElementChild!.remove();
  };
  const thead = wrap.querySelector('thead')!;
  const tbody = wrap.querySelector('tbody')!;
  const head =
    (thead.firstElementChild as HTMLTableRowElement | null) ??
    thead.appendChild(document.createElement('tr'));
  syncRow(head, table.head, 0, 'th');
  table.rows.forEach((cells, i) => {
    const tr =
      (tbody.children[i] as HTMLTableRowElement | undefined) ??
      tbody.appendChild(document.createElement('tr'));
    syncRow(tr, cells, i + 1, 'td');
  });
  while (tbody.children.length > table.rows.length) tbody.lastElementChild!.remove();
  if (!editingCell(wrap)) wrap.classList.remove('editing');
  refreshTools.get(wrap)?.();
}

/** The table's text layout, read fresh from the note (positions move with every edit). */
function layoutOf(view: EditorView, wrap: HTMLElement): TableLayout | null {
  return tableLayoutAt(view.state, view.posAtDOM(wrap));
}

function cellAt(wrap: HTMLElement, row: number, col: number): HTMLTableCellElement | null {
  return wrap.querySelector(`[data-row="${row}"][data-col="${col}"]`);
}

function size(wrap: HTMLElement) {
  const table = drawnFrom.get(wrap)?.table;
  return { rows: (table?.rows.length ?? 0) + 1, columns: table?.head.length ?? 0 };
}

// ------------------------------------------------------------------ Editing

/** Turn a cell into a text box with its markdown, and put the cursor in it. */
function edit(
  view: EditorView,
  wrap: HTMLElement,
  cell: HTMLTableCellElement,
  caret: 'start' | 'end' = 'end',
) {
  if (!drawnFrom.get(wrap)?.editable || view.state.readOnly) return;
  const existing = cell.querySelector<HTMLTextAreaElement>('.cm-md-cell-input');
  if (existing) {
    existing.focus();
    return;
  }
  const layout = layoutOf(view, wrap);
  if (!layout) return;
  const { row, col } = position(cell);
  const value = cellText(layout, row, col);

  // Keep the column as wide as it was, so the table doesn't jump.
  cell.style.minWidth = `${cell.getBoundingClientRect().width}px`;
  const input = document.createElement('textarea');
  input.className = 'cm-md-cell-input';
  input.rows = 1;
  input.cols = 1; // Fill the cell instead of a default 20 characters (which widens the column).
  input.value = value;
  input.spellcheck = true;
  input.setAttribute('autocapitalize', 'sentences');
  input.setAttribute(
    'aria-label',
    row === 0 ? `Header, column ${col + 1}` : `Row ${row}, column ${col + 1}`,
  );
  cell.classList.add('cm-md-cell-editing');
  cell.replaceChildren(input);
  wrap.classList.add('editing');
  grow(input);
  input.focus({ preventScroll: true });
  const at = caret === 'start' ? 0 : value.length;
  input.setSelectionRange(at, at);
  refreshTools.get(wrap)?.();

  input.addEventListener('input', () => {
    grow(input);
    write(view, wrap, input);
  });
  input.addEventListener('keydown', (event) => onKey(event, view, wrap, input));
  input.addEventListener('blur', () => done(view, wrap, cell));
}

/** Show the cell as a table cell again. */
function done(view: EditorView, wrap: HTMLElement, cell: HTMLTableCellElement) {
  if (!cell.querySelector('.cm-md-cell-input')) return;
  cell.classList.remove('cm-md-cell-editing');
  cell.style.minWidth = '';
  const table = drawnFrom.get(wrap)?.table;
  const { row, col } = position(cell);
  cell.replaceChildren();
  const cells = row === 0 ? table?.head : table?.rows[row - 1];
  renderInline(cells?.[col] ?? [], cell, view);
  if (!editingCell(wrap)) wrap.classList.remove('editing');
}

/** For measuring text without touching the page. */
let measure: CanvasRenderingContext2D | null = null;

/** Widen the text box (and so its column) to fit the text, up to about 20em; then wrap. */
function grow(input: HTMLTextAreaElement) {
  measure ??= document.createElement('canvas').getContext('2d');
  if (measure) {
    const style = getComputedStyle(input);
    measure.font = style.font;
    const width = Math.ceil(measure.measureText(input.value).width) + 2;
    const max = parseFloat(style.fontSize) * 20;
    input.style.minWidth = `${Math.min(width, max)}px`;
  }
  input.style.height = 'auto';
  input.style.height = `${input.scrollHeight}px`;
}

/** Write the text box into the cell's place in the note. */
function write(view: EditorView, wrap: HTMLElement, input: HTMLTextAreaElement) {
  const cell = input.closest<HTMLTableCellElement>('th, td');
  const layout = layoutOf(view, wrap);
  if (!cell || !layout) return;
  const { row, col } = position(cell);
  const change = setCell(layout, row, col, input.value);
  if (change) view.dispatch({ changes: change, userEvent: 'input.type' });
}

/** Edit another cell. */
function go(
  view: EditorView,
  wrap: HTMLElement,
  row: number,
  col: number,
  caret: 'start' | 'end' = 'end',
) {
  const cell = cellAt(wrap, row, col);
  if (cell) edit(view, wrap, cell, caret);
}

/** Leave the table and put the cursor in the text just before or after it. */
function leave(view: EditorView, wrap: HTMLElement, side: 'before' | 'after') {
  const layout = layoutOf(view, wrap);
  (document.activeElement as HTMLElement | null)?.blur();
  view.focus();
  if (!layout) return;
  const doc = view.state.doc;
  const anchor =
    side === 'before' ? Math.max(0, layout.from - 1) : Math.min(doc.length, layout.to + 1);
  view.dispatch({ selection: { anchor }, scrollIntoView: true });
}

/** Apply a change to the table's lines, then edit the cell at row, col (if given). */
function change(
  view: EditorView,
  wrap: HTMLElement,
  build: (layout: TableLayout) => ChangeSpec | null,
  then?: { row: number; col: number },
) {
  const layout = layoutOf(view, wrap);
  const changes = layout && build(layout);
  if (!changes) return;
  // Finish the current cell first: rows and columns may move under it.
  const current = editingCell(wrap);
  if (current) done(view, wrap, current);
  view.dispatch({ changes, userEvent: 'input' });
  if (then) go(view, wrap, then.row, then.col);
}

function onKey(
  event: KeyboardEvent,
  view: EditorView,
  wrap: HTMLElement,
  input: HTMLTextAreaElement,
) {
  const cell = input.closest<HTMLTableCellElement>('th, td');
  if (!cell || event.isComposing) return;
  const { row, col } = position(cell);
  const { rows, columns } = size(wrap);
  const handled = () => {
    event.preventDefault();
    event.stopPropagation();
  };
  if (event.key === 'Tab') {
    handled();
    if (event.shiftKey) {
      if (col > 0) go(view, wrap, row, col - 1);
      else if (row > 0) go(view, wrap, row - 1, columns - 1);
    } else if (col < columns - 1) go(view, wrap, row, col + 1);
    else if (row < rows - 1) go(view, wrap, row + 1, 0);
    else change(view, wrap, (t) => insertRow(t, row), { row: row + 1, col: 0 });
  } else if (event.key === 'Enter') {
    handled();
    if (row < rows - 1) go(view, wrap, row + 1, col);
    else change(view, wrap, (t) => insertRow(t, row), { row: row + 1, col });
  } else if (event.key === 'Escape') {
    handled();
    leave(view, wrap, 'after');
  } else if (event.key === 'ArrowUp' && !event.shiftKey) {
    handled();
    if (row > 0) go(view, wrap, row - 1, col);
    else leave(view, wrap, 'before');
  } else if (event.key === 'ArrowDown' && !event.shiftKey) {
    handled();
    if (row < rows - 1) go(view, wrap, row + 1, col);
    else leave(view, wrap, 'after');
  }
}

// ------------------------------------------------------------------ Buttons

/** A button that keeps the text box focused (no blur on press). */
function button(
  className: string,
  label: string,
  icon: IconName,
  onClick: () => void,
): HTMLButtonElement {
  const el = element('button', className) as HTMLButtonElement;
  el.type = 'button';
  el.title = label;
  el.setAttribute('aria-label', label);
  el.append(iconSvg(icon, className.includes('add') ? 16 : 20));
  const keep = (event: Event) => event.preventDefault();
  el.addEventListener('mousedown', keep);
  el.addEventListener('pointerdown', keep);
  el.addEventListener('click', (event) => {
    event.preventDefault();
    onClick();
  });
  return el;
}

/** The "+" bars below and to the right of the table. */
function addButton(
  view: EditorView,
  wrap: HTMLElement,
  className: string,
  label: string,
  icon: IconName,
) {
  const column = className.endsWith('col');
  return button(`cm-md-table-add ${className}`, label, icon, () => {
    const { rows, columns } = size(wrap);
    const at = editingCell(wrap);
    const current = at ? position(at) : null;
    if (column) {
      change(view, wrap, (t) => insertColumn(t, columns - 1), {
        row: current?.row ?? 0,
        col: columns,
      });
    } else {
      change(view, wrap, (t) => insertRow(t, rows - 1), { row: rows, col: current?.col ?? 0 });
    }
  });
}

/** The tool row shown while a cell is being edited. */
function tools(view: EditorView, wrap: HTMLElement): HTMLElement {
  const bar = element('div', 'cm-md-table-tools');
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Table');
  const at = () => {
    const cell = editingCell(wrap);
    return cell ? position(cell) : null;
  };
  // Markdown aligns whole columns. Pressing the current alignment goes back to the default.
  const aligns = (
    [
      ['left', 'Align column left', 'alignLeft'],
      ['center', 'Center column', 'alignCenter'],
      ['right', 'Align column right', 'alignRight'],
    ] as const
  ).map(([align, label, icon]) => ({
    align: align as ColumnAlign,
    el: button('cm-md-table-tool', label, icon, () => {
      const p = at();
      const layout = layoutOf(view, wrap);
      if (!p || !layout) return;
      const next = columnAlign(layout, p.col) === align ? null : align;
      change(view, wrap, (t) => setColumnAlign(t, p.col, next), p);
    }),
  }));
  const rowDelete = button('cm-md-table-tool', 'Delete row', 'rowDelete', () => {
    const p = at();
    if (!p || p.row === 0) return;
    const { rows } = size(wrap);
    change(view, wrap, (t) => deleteRow(t, p.row), { row: Math.min(p.row, rows - 2), col: p.col });
  });
  const colDelete = button('cm-md-table-tool', 'Delete column', 'colDelete', () => {
    const p = at();
    const { columns } = size(wrap);
    if (!p || columns <= 1) return;
    change(view, wrap, (t) => deleteColumn(t, p.col), {
      row: p.row,
      col: Math.min(p.col, columns - 2),
    });
  });
  bar.append(
    button('cm-md-table-tool', 'Add row below', 'rowAdd', () => {
      const p = at();
      if (p) change(view, wrap, (t) => insertRow(t, p.row), { row: p.row + 1, col: p.col });
    }),
    button('cm-md-table-tool', 'Add column to the right', 'colAdd', () => {
      const p = at();
      if (p) change(view, wrap, (t) => insertColumn(t, p.col), { row: p.row, col: p.col + 1 });
    }),
    rowDelete,
    colDelete,
    element('span', 'cm-md-table-tools-gap'),
    ...aligns.map((a) => a.el),
    element('span', 'cm-md-table-tools-gap'),
    button('cm-md-table-tool', 'Edit as text', 'text', () => {
      const layout = layoutOf(view, wrap);
      if (!layout) return;
      (document.activeElement as HTMLElement | null)?.blur();
      view.focus();
      view.dispatch({
        effects: showTableText.of({ from: layout.from, to: layout.to }),
        selection: { anchor: layout.from },
      });
    }),
  );
  // Deleting the header row or the only column is not possible; the current
  // column's alignment shows as pressed.
  const refresh = () => {
    const p = at();
    rowDelete.disabled = !p || p.row === 0;
    colDelete.disabled = size(wrap).columns <= 1;
    const layout = p ? layoutOf(view, wrap) : null;
    const current = layout && p ? columnAlign(layout, p.col) : null;
    for (const a of aligns) {
      a.el.classList.toggle('on', a.align === current);
      a.el.setAttribute('aria-pressed', String(a.align === current));
    }
  };
  refreshTools.set(wrap, refresh);
  wrap.addEventListener('focusin', refresh);
  return bar;
}

// ------------------------------------------------------------------ Taps and clicks

function listen(wrap: HTMLElement, view: EditorView) {
  const open = (target: Element | null, force: boolean) => {
    const link = target?.closest('[data-href]');
    const href = link?.getAttribute('data-href') ?? null;
    if (!link || !force || !isOpenable(href)) return false;
    window.open(href, '_blank', 'noopener,noreferrer');
    return true;
  };
  const tap = (target: Element | null, touch: boolean, modifier: boolean) => {
    // A tap opens a link (as in the text); with a mouse, Ctrl/Cmd+click does.
    if (open(target, touch || modifier)) return;
    const cell = target?.closest<HTMLTableCellElement>('th, td');
    if (cell && wrap.contains(cell)) edit(view, wrap, cell);
  };

  // Mouse: no text selection or editor cursor from pressing on the table.
  wrap.addEventListener('mousedown', (event) => {
    if (!(event.target as Element).closest('textarea, button')) event.preventDefault();
  });
  wrap.addEventListener('click', (event) => {
    const target = event.target as Element;
    if (target.closest('textarea, button')) return;
    tap(target, false, event.ctrlKey || event.metaKey);
  });

  // Touch: handle the tap ourselves (as checkboxes do), ignoring scrolls.
  let start: { x: number; y: number } | null = null;
  wrap.addEventListener(
    'touchstart',
    (event) => {
      const t = event.touches[0];
      start = t ? { x: t.clientX, y: t.clientY } : null;
    },
    { passive: true },
  );
  wrap.addEventListener(
    'touchend',
    (event) => {
      const t = event.changedTouches[0];
      const moved = !start || !t || Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10;
      start = null;
      const target = event.target as Element;
      if (moved || target.closest('textarea, button')) return;
      event.preventDefault(); // No click, and the editor's keyboard stays closed.
      tap(target, true, false);
    },
    { passive: false },
  );
}

/** Opens a cell for typing when a transaction asks for it (a table from the format bar). */
export const openRequestedCell = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {}

    update(update: ViewUpdate) {
      for (const tr of update.transactions) {
        const request = tr.annotation(editCell);
        if (!request) continue;
        // After the format bar has given focus back to the editor.
        queueMicrotask(() => {
          const view = this.view;
          for (const wrap of view.contentDOM.querySelectorAll<HTMLElement>('.cm-md-table-widget')) {
            if (view.posAtDOM(wrap) === request.pos) go(view, wrap, request.row, request.col);
          }
        });
      }
    }
  },
);
