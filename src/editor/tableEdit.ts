/**
 * Editing GFM tables as text: where each cell is, and the changes that set a
 * cell or add and remove rows and columns. Each change touches only the
 * lines it is about. No DOM (CLAUDE.md); the table widget calls these.
 *
 * Rows are numbered 0 for the header, then 1, 2, ... for the body. The
 * `|---|` delimiter row is not a numbered row.
 */
import { syntaxTree } from '@codemirror/language';
import { Annotation, type ChangeSpec, type EditorState } from '@codemirror/state';

/**
 * On a transaction that adds a table: open the cell at row, col of the table
 * starting at `pos` for typing (tableWidget.ts does that).
 */
export const editCell = Annotation.define<{ pos: number; row: number; col: number }>();

/** One cell: the text between two pipes (`from`–`to`), and that text trimmed. */
export interface CellSpan {
  from: number;
  to: number;
  text: string;
}

/** One line of a table. `from`–`to` is the whole line. */
export interface RowSpan {
  from: number;
  to: number;
  cells: CellSpan[];
}

export interface TableLayout {
  /** Start of the header line and end of the last line. */
  from: number;
  to: number;
  /** Leading whitespace of the header line, kept on rebuilt lines. */
  indent: string;
  header: RowSpan;
  delimiter: RowSpan;
  body: RowSpan[];
  /** Columns, from the header. */
  columns: number;
}

/** The cells of one table line, split at pipes that are not escaped as `\|`. */
export function splitRow(text: string, lineFrom = 0): CellSpan[] {
  const pipes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === '|') pipes.push(i);
  }
  const start = text.length - text.trimStart().length;
  const end = text.trimEnd().length;
  const leading = pipes[0] === start;
  const trailing = pipes.length > (leading ? 1 : 0) && pipes.at(-1) === end - 1;
  // Each pipe ends a cell; text after the last pipe is a cell too, unless the row ends with one.
  const bounds: [number, number][] = [];
  let from = leading ? pipes[0]! + 1 : start;
  for (const pipe of leading ? pipes.slice(1) : pipes) {
    bounds.push([from, pipe]);
    from = pipe + 1;
  }
  if (!trailing) bounds.push([from, end]);
  return bounds.map(([a, b]) => ({
    from: lineFrom + a,
    to: lineFrom + b,
    text: text.slice(a, b).trim(),
  }));
}

/** The table that contains `pos` (or starts on its line), as cells and lines. */
export function tableLayoutAt(state: EditorState, pos: number): TableLayout | null {
  const { doc } = state;
  const line = doc.lineAt(pos);
  // Just inside the line's first character, which may be indented.
  const indent = line.text.length - line.text.trimStart().length;
  let node = syntaxTree(state).resolveInner(Math.min(line.to, line.from + indent + 1), 1);
  while (node.name !== 'Table' && node.parent) node = node.parent;
  if (node.name !== 'Table') return null;
  const first = doc.lineAt(node.from);
  const end = doc.lineAt(node.to);
  const last = end.from === node.to && node.to > node.from ? doc.line(end.number - 1) : end;
  if (last.number < first.number + 1) return null;
  const row = (n: number): RowSpan => {
    const l = doc.line(n);
    return { from: l.from, to: l.to, cells: splitRow(l.text, l.from) };
  };
  const header = row(first.number);
  const body: RowSpan[] = [];
  for (let n = first.number + 2; n <= last.number; n++) body.push(row(n));
  return {
    from: first.from,
    to: last.to,
    indent: /^\s*/.exec(first.text)![0],
    header,
    delimiter: row(first.number + 1),
    body,
    columns: header.cells.length,
  };
}

/** A row by number: 0 is the header, 1.. the body. */
export function rowAt(layout: TableLayout, row: number): RowSpan | null {
  return row === 0 ? layout.header : (layout.body[row - 1] ?? null);
}

/** The markdown text of a cell ('' for a cell the row doesn't have). */
export function cellText(layout: TableLayout, row: number, col: number): string {
  return rowAt(layout, row)?.cells[col]?.text ?? '';
}

/** Text for a cell: one line, and `|` escaped so it doesn't split the cell. */
export function escapeCell(value: string): string {
  return value.replace(/\s*\r?\n\s*/g, ' ').replace(/(?<!\\)\|/g, '\\|');
}

/** A table line from cell texts: `| a | b |`. */
function rowLine(indent: string, cells: readonly string[]): string {
  return `${indent}| ${cells.join(' | ')} |`;
}

/** A row's cell texts, padded (or cut) to the table's column count. */
function texts(layout: TableLayout, row: RowSpan, fill = ''): string[] {
  return Array.from({ length: layout.columns }, (_, i) => row.cells[i]?.text ?? fill);
}

/** Every line of the table: header, delimiter, body. */
function allRows(layout: TableLayout): { row: RowSpan; delimiter: boolean }[] {
  return [
    { row: layout.header, delimiter: false },
    { row: layout.delimiter, delimiter: true },
    ...layout.body.map((row) => ({ row, delimiter: false })),
  ];
}

/** Set a cell's text. Only that cell changes, unless the row is too short for it. */
export function setCell(
  layout: TableLayout,
  row: number,
  col: number,
  value: string,
): ChangeSpec | null {
  const line = rowAt(layout, row);
  if (!line || col < 0 || col >= layout.columns) return null;
  const text = escapeCell(value).trim();
  const cell = line.cells[col];
  if (cell) return { from: cell.from, to: cell.to, insert: text ? ` ${text} ` : '  ' };
  const cells = texts(layout, line);
  cells[col] = text;
  return { from: line.from, to: line.to, insert: rowLine(layout.indent, cells) };
}

/** Add an empty row after `after` (0 = right under the header). Its number is `after + 1`. */
export function insertRow(layout: TableLayout, after: number): ChangeSpec | null {
  const line = after === 0 ? layout.delimiter : layout.body[after - 1];
  if (!line) return null;
  const empty = new Array<string>(layout.columns).fill('');
  return { from: line.to, insert: `\n${rowLine(layout.indent, empty)}` };
}

/** Add an empty column after column `after` (-1 = at the start). */
export function insertColumn(layout: TableLayout, after: number): ChangeSpec[] {
  return allRows(layout).map(({ row, delimiter }) => {
    const cells = texts(layout, row, delimiter ? '---' : '');
    cells.splice(after + 1, 0, delimiter ? '---' : '');
    return { from: row.from, to: row.to, insert: rowLine(layout.indent, cells) };
  });
}

/** Remove a body row (the header stays). */
export function deleteRow(layout: TableLayout, row: number): ChangeSpec | null {
  const line = row > 0 ? layout.body[row - 1] : undefined;
  return line ? { from: line.from - 1, to: line.to } : null;
}

/** Remove a column, unless it is the only one. */
export function deleteColumn(layout: TableLayout, col: number): ChangeSpec[] | null {
  if (layout.columns <= 1 || col < 0 || col >= layout.columns) return null;
  return allRows(layout).map(({ row, delimiter }) => {
    const cells = texts(layout, row, delimiter ? '---' : '');
    cells.splice(col, 1);
    return { from: row.from, to: row.to, insert: rowLine(layout.indent, cells) };
  });
}

export type ColumnAlign = 'left' | 'center' | 'right' | null;

/** A column's alignment, from its `:--` / `:-:` / `--:` cell in the delimiter row. */
export function columnAlign(layout: TableLayout, col: number): ColumnAlign {
  const cell = layout.delimiter.cells[col]?.text ?? '';
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  return left && right ? 'center' : right ? 'right' : left ? 'left' : null;
}

/** Set a column's alignment (null: the default). Only the delimiter row changes. */
export function setColumnAlign(
  layout: TableLayout,
  col: number,
  align: ColumnAlign,
): ChangeSpec | null {
  if (col < 0 || col >= layout.columns) return null;
  const cells = texts(layout, layout.delimiter, '---');
  cells[col] =
    align === 'left' ? ':---' : align === 'center' ? ':---:' : align === 'right' ? '---:' : '---';
  const row = layout.delimiter;
  return { from: row.from, to: row.to, insert: rowLine(layout.indent, cells) };
}

/** A new empty table: a header row and one row, two columns. */
export const NEW_TABLE = '|  |  |\n| --- | --- |\n|  |  |';
