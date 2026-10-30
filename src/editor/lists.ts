/**
 * List and task behavior: checkbox toggling, Tab/Shift+Tab nesting, the
 * `[]` shorthand and moving items. Pure functions over EditorState, no DOM.
 */
import { indentLess, indentMore, moveLineDown, moveLineUp } from '@codemirror/commands';
import { insertNewlineContinueMarkupCommand } from '@codemirror/lang-markdown';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import {
  EditorSelection,
  type ChangeSpec,
  type EditorState,
  type StateCommand,
  type TransactionSpec,
} from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';

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

// ------------------------------------------------------------ moving items

/** The innermost list item that starts on the line at `pos`. */
function itemOnLine(state: EditorState, pos: number): SyntaxNode | null {
  const line = state.doc.lineAt(pos);
  const found: SyntaxNode[] = [];
  syntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter(ref) {
      if (ref.name === 'ListItem' && ref.from >= line.from) found.push(ref.node);
    },
  });
  return found.at(-1) ?? null;
}

/** Indentation width in columns (a tab counts to the next multiple of 4). */
function indentOf(text: string): number {
  let n = 0;
  for (const ch of text) {
    if (ch === ' ') n++;
    else if (ch === '\t') n += 4 - (n % 4);
    else break;
  }
  return n;
}

const isBlank = (text: string) => text.trim() === '';

/**
 * The last line of the item on line `n` with its children: the lines right
 * below it that are indented further. A blank or less indented line ends them.
 */
function lastChildLine(state: EditorState, n: number): number {
  const { doc } = state;
  const indent = indentOf(doc.line(n).text);
  let last = n;
  while (last < doc.lines) {
    const next = doc.line(last + 1).text;
    if (isBlank(next) || indentOf(next) <= indent) break;
    last++;
  }
  return last;
}

/** A text change, in the coordinates of the text it applies to. */
interface Edit {
  from: number;
  to: number;
  insert: string;
}

/**
 * Renumber every numbered list that overlaps from–to, counting from the
 * list's lowest number (its first number before items were moved).
 */
function renumberLists(state: EditorState, from: number, to: number): Edit[] {
  const { doc } = state;
  const edits: Edit[] = [];
  const tree = ensureSyntaxTree(state, to, 200) ?? syntaxTree(state);
  tree.iterate({
    from,
    to,
    enter(ref) {
      if (ref.name !== 'OrderedList') return;
      const marks = ref.node
        .getChildren('ListItem')
        .flatMap((item) => item.getChild('ListMark') ?? [])
        .map((mark) => ({ mark, old: doc.sliceString(mark.from, mark.to) }));
      const start = Math.min(...marks.map((m) => parseInt(m.old) || 1));
      marks.forEach(({ mark, old }, k) => {
        const text = `${start + k}${old.slice(-1)}`;
        if (text !== old) edits.push({ from: mark.from, to: mark.to, insert: text });
      });
    },
  });
  return edits.sort((a, b) => a.from - b.from);
}

/** Map a position through renumbering edits, keeping it on the same side of each number. */
function mapThrough(edits: Edit[], pos: number): number {
  let shift = 0;
  for (const e of edits) {
    if (pos <= e.from) break;
    if (pos < e.to) return e.from + shift + Math.min(pos - e.from, e.insert.length);
    shift += e.insert.length - (e.to - e.from);
  }
  return pos + shift;
}

/**
 * Move the list item on the line at `pos` one line up or down, together with
 * its children (the indented lines right below it). Blank lines and plain
 * text are passed one line at a time. Other items move as a whole: moving up
 * from under an item's children jumps above that item, and moving down onto
 * an item with children jumps past them. Numbered lists are renumbered and
 * the selection moves with the text. Null if the line is not a list item,
 * or at the start or end of the note.
 */
export function moveListItem(state: EditorState, pos: number, dir: -1 | 1): TransactionSpec | null {
  const { doc } = state;
  const first = doc.lineAt(pos);
  if (!itemOnLine(state, first.from)) return null;
  const last = doc.line(lastChildLine(state, first.number));
  const indent = indentOf(first.text);

  // Up: the line to paste before. Down: the line to paste after.
  const up = dir < 0;
  let target: number;
  if (up) {
    if (first.number === 1) return null;
    target = first.number - 1;
    // The line above is a child of an item further up: jump above that item.
    let k = target;
    while (k >= 1 && !isBlank(doc.line(k).text) && indentOf(doc.line(k).text) > indent) k--;
    if (k < target && k >= 1 && !isBlank(doc.line(k).text) && itemOnLine(state, doc.line(k).from)) {
      target = k;
    }
  } else {
    if (last.number === doc.lines) return null;
    target = last.number + 1;
    // The line below is an item: move past its children too.
    if (itemOnLine(state, doc.line(target).from)) target = lastChildLine(state, target);
  }

  // A cut and a paste of whole lines, like Alt+↑/↓ in most editors.
  const block = doc.sliceString(first.from, last.to);
  const at = up ? doc.line(target).from : doc.line(target).to;
  const move = state.changes([
    up ? { from: first.from - 1, to: last.to } : { from: first.from, to: last.to + 1 },
    { from: at, insert: up ? block + '\n' : '\n' + block },
  ]);
  const blockStart = move.mapPos(at, -1) + (up ? 0 : 1);
  const moved = (p: number) =>
    p >= first.from && p <= last.to ? blockStart + (p - first.from) : move.mapPos(p, up ? 1 : -1);

  // The moved lines and the lines passed keep their total length.
  const region = up ? { from: at, to: last.to } : { from: first.from, to: at };
  const next = state.update({ changes: move }).state;
  const edits = renumberLists(next, region.from, region.to);
  const map = (p: number) => mapThrough(edits, moved(p));

  return {
    changes: move.compose(next.changes(edits)),
    selection: EditorSelection.create(
      state.selection.ranges.map((r) => EditorSelection.range(map(r.anchor), map(r.head))),
      state.selection.mainIndex,
    ),
    userEvent: 'move.line',
  };
}

/**
 * Move up/down (Alt+↑/↓ and the format bar). On a list item line, the item
 * moves with its children (see `moveListItem`). Anywhere else, the selected
 * lines move.
 */
function moveItem(dir: -1 | 1): StateCommand {
  const moveLines = dir < 0 ? moveLineUp : moveLineDown;
  return (target) => {
    const { state, dispatch } = target;
    if (state.readOnly) return false;
    const { main, ranges } = state.selection;
    const oneLine = state.doc.lineAt(main.from).number === state.doc.lineAt(main.to).number;
    if (ranges.length === 1 && oneLine && itemOnLine(state, main.head)) {
      const spec = moveListItem(state, main.head, dir);
      if (spec) dispatch(state.update(spec, { scrollIntoView: true }));
      return true;
    }
    return moveLines(target);
  };
}

export const moveItemUp = moveItem(-1);
export const moveItemDown = moveItem(1);

/** Indent (Tab and the format bar): nest a list item, or indent other lines. */
export const indentItem: StateCommand = (target) => indentListItem(target) || indentMore(target);
/** Outdent (Shift+Tab and the format bar). */
export const outdentItem: StateCommand = (target) => outdentListItem(target) || indentLess(target);
