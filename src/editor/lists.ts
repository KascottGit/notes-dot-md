/**
 * List and task behavior: checkbox toggling, Tab/Shift+Tab nesting and the
 * `[]` shorthand. Pure functions over EditorState, no DOM.
 */
import { insertNewlineContinueMarkupCommand } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import type { ChangeSpec, EditorState, StateCommand, TransactionSpec } from '@codemirror/state';

/** A list item line: indentation, marker, and the spaces after it. */
const ITEM = /^(\s*)([-*+]|\d+[.)])([ \t]+|$)/;
const TASK_BOX = /\[([ xX])\]/;

interface Item {
  indent: number;
  /** Column where the item's text starts; children are indented to here. */
  content: number;
}

function parseItem(text: string): Item | null {
  const m = ITEM.exec(text);
  if (!m) return null;
  const indent = m[1]!.length;
  return { indent, content: indent + m[2]!.length + Math.max(1, m[3]!.length) };
}

function leadingSpaces(text: string): number {
  return /^ */.exec(text)![0].length;
}

/**
 * Swap `[ ]` and `[x]` for the task whose checkbox starts at `pos`.
 * Only the one character between the brackets changes.
 */
export function toggleTaskAt(state: EditorState, pos: number): TransactionSpec | null {
  const line = state.doc.lineAt(pos);
  const offset = pos - line.from;
  const m = TASK_BOX.exec(line.text.slice(offset));
  // The box is right at pos (ordered list) or after a bullet marker.
  if (!m || m.index > 4) return null;
  const at = line.from + offset + m.index + 1;
  return { changes: { from: at, to: at + 1, insert: m[1] === ' ' ? 'x' : ' ' } };
}

/** Line numbers touched by the selection, in order. */
function selectedLines(state: EditorState): number[] {
  const lines = new Set<number>();
  for (const r of state.selection.ranges) {
    const last = state.doc.lineAt(r.to).number;
    for (let n = state.doc.lineAt(r.from).number; n <= last; n++) lines.add(n);
  }
  return [...lines].sort((a, b) => a - b);
}

/** The nearest list item above line `n` (skipping blank and continuation lines). */
function previousItems(state: EditorState, n: number): Item[] {
  const items: Item[] = [];
  for (let i = n - 1; i >= 1; i--) {
    const text = state.doc.line(i).text;
    const item = parseItem(text);
    if (item) items.push(item);
    else if (text.trim() !== '' && leadingSpaces(text) === 0) break; // Left the list.
  }
  return items;
}

/** Shift every non-blank selected line by `delta` columns (spaces). */
function shiftLines(state: EditorState, lines: number[], delta: number): TransactionSpec {
  const changes = lines.flatMap((n): ChangeSpec[] => {
    const line = state.doc.line(n);
    if (line.text.trim() === '') return [];
    if (delta > 0) return [{ from: line.from, insert: ' '.repeat(delta) }];
    const remove = Math.min(-delta, leadingSpaces(line.text));
    return remove ? [{ from: line.from, to: line.from + remove }] : [];
  });
  return { changes, userEvent: delta > 0 ? 'input.indent' : 'delete.dedent' };
}

function firstListLine(state: EditorState, lines: number[]): { n: number; item: Item } | null {
  for (const n of lines) {
    const item = parseItem(state.doc.line(n).text);
    if (item) return { n, item };
  }
  return null;
}

/**
 * Tab in a list: make the item a child of the item above it, by indenting to
 * that item's text column (so `1. ` lists nest correctly too).
 * Returns false outside lists, so Tab falls back to normal indenting.
 */
export const indentListItem: StateCommand = ({ state, dispatch }) => {
  const lines = selectedLines(state);
  const first = firstListLine(state, lines);
  if (!first) return false;
  const sibling = previousItems(state, first.n).find((p) => p.indent <= first.item.indent);
  // Nothing to nest under (first item, or already a child): do nothing, but keep the key.
  if (!sibling || sibling.indent < first.item.indent) return true;
  dispatch(state.update(shiftLines(state, lines, sibling.content - first.item.indent)));
  return true;
};

/** Shift+Tab in a list: move the item out one level. */
export const outdentListItem: StateCommand = ({ state, dispatch }) => {
  const lines = selectedLines(state);
  const first = firstListLine(state, lines);
  if (!first) return false;
  if (first.item.indent === 0) return true;
  const parent = previousItems(state, first.n).find((p) => p.indent < first.item.indent);
  const target = parent?.indent ?? 0;
  dispatch(state.update(shiftLines(state, lines, target - first.item.indent)));
  return true;
};

/**
 * Task shorthand, applied when `]` is typed:
 * - `- []`  → `- [ ] `   (`[]` right after a list marker)
 * - `-[]`   → `- [ ] `
 * - `-[ ]`  → `- [ ]`    (missing space after the marker)
 * Returns the new line start, or null to type `]` normally.
 */
export function expandTaskShorthand(before: string, typed: string): string | null {
  if (typed !== ']') return null;
  let m = /^(\s*)([-*+]|\d+[.)]) \[$/.exec(before);
  if (m) return `${m[1]}${m[2]} [ ] `;
  m = /^(\s*)([-*+])\[$/.exec(before);
  if (m) return `${m[1]}${m[2]} [ ] `;
  m = /^(\s*)([-*+])\[([ xX])$/.exec(before);
  if (m) return `${m[1]}${m[2]} [${m[3]}]`;
  return null;
}

/**
 * Enter continues lists and tasks; Enter on an empty item ends the list
 * (instead of CodeMirror's default of first turning it into a loose list).
 */
export const continueList = insertNewlineContinueMarkupCommand({ nonTightLists: false });

const CODE_NODES = new Set(['FencedCode', 'CodeBlock', 'InlineCode', 'CodeText', 'Frontmatter']);

/** For EditorView.inputHandler: the change to make instead of typing `text`, if any. */
export function shorthandInput(
  state: EditorState,
  from: number,
  to: number,
  text: string,
): TransactionSpec | null {
  if (from !== to || text !== ']') return null;
  for (let node = syntaxTree(state).resolveInner(from, -1); node.parent; node = node.parent) {
    if (CODE_NODES.has(node.name)) return null;
  }
  const line = state.doc.lineAt(from);
  const replacement = expandTaskShorthand(line.text.slice(0, from - line.from), text);
  if (replacement === null) return null;
  return {
    changes: { from: line.from, to: from, insert: replacement },
    selection: { anchor: line.from + replacement.length },
    userEvent: 'input.type',
  };
}
