/**
 * List and task behavior: checkbox toggling, Tab/Shift+Tab nesting, the
 * `[]` shorthand and moving items. Pure functions over EditorState, no DOM.
 */
import { indentLess, indentMore, moveLineDown, moveLineUp } from '@codemirror/commands';
import { insertNewlineContinueMarkupCommand } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import {
  ChangeSet,
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

/** The lines (1-based, inclusive) of one list item with its sub-items. */
export interface ItemBlock {
  from: number;
  to: number;
}

export interface ListSiblings {
  /** Every item of the list, in order. */
  blocks: ItemBlock[];
  /** The block of the item that was asked about. */
  index: number;
}

interface Siblings extends ListSiblings {
  /** ListMark ranges, per block, when the list is numbered. */
  numbers: { from: number; to: number }[] | null;
}

function siblingsOf(state: EditorState, pos: number): Siblings | null {
  const { doc } = state;
  const item = itemOnLine(state, pos);
  const list = item?.parent;
  if (!item || !list || (list.name !== 'BulletList' && list.name !== 'OrderedList')) return null;
  const blocks: ItemBlock[] = [];
  const numbers: { from: number; to: number }[] = [];
  let index = -1;
  for (let child = list.firstChild; child; child = child.nextSibling) {
    if (child.name !== 'ListItem') continue;
    const first = doc.lineAt(child.from);
    // Items are moved as whole lines, so each must start its own line
    // (only indentation or quote markers before it).
    if (!/^[\s>]*$/.test(doc.sliceString(first.from, child.from))) return null;
    const end = doc.lineAt(child.to);
    const last = end.from === child.to && child.to > child.from ? end.number - 1 : end.number;
    const prev = blocks.at(-1);
    if (prev && prev.to >= first.number) return null;
    if (child.from === item.from) index = blocks.length;
    blocks.push({ from: first.number, to: last });
    const mark = child.getChild('ListMark');
    if (mark) numbers.push({ from: mark.from, to: mark.to });
  }
  if (index < 0) return null;
  const ordered = list.name === 'OrderedList' && numbers.length === blocks.length;
  return { blocks, index, numbers: ordered ? numbers : null };
}

/** The items of the list that the item starting on the line at `pos` belongs to. */
export function listSiblings(state: EditorState, pos: number): ListSiblings | null {
  const s = siblingsOf(state, pos);
  return s && { blocks: s.blocks, index: s.index };
}

/**
 * Move the list item on the line at `pos`, with its sub-items, to `slot`
 * among its siblings: 0 is before the first item, `blocks.length` after the
 * last. Like Alt+↑/↓, it is a cut and a paste, so the rest of the text (and
 * its undo history) is untouched. Numbered lists are renumbered, and the
 * selection moves with the text. Null if nothing moves.
 */
export function moveListItem(
  state: EditorState,
  pos: number,
  slot: number,
): TransactionSpec | null {
  const s = siblingsOf(state, pos);
  if (!s) return null;
  const { blocks, index, numbers } = s;
  const n = blocks.length;
  if (slot < 0 || slot > n || slot === index || slot === index + 1) return null;

  const { doc } = state;
  const from = (k: number) => doc.line(blocks[k]!.from).from;
  const to = (k: number) => doc.line(blocks[k]!.to).to;
  const block = doc.sliceString(from(index), to(index));
  const down = slot > index;

  // Cut the item with the separator (line break, blank lines) on one side of
  // it, and paste both at the slot.
  let cut: { from: number; to: number };
  let at: number;
  let paste: string;
  let offset: number; // where the item starts within `paste`
  if (down) {
    cut = { from: from(index), to: from(index + 1) };
    const gap = doc.sliceString(to(index), from(index + 1));
    at = to(slot - 1);
    paste = gap + block;
    offset = gap.length;
  } else {
    // Up: take the separator after the item, or before it for the last one.
    cut =
      index < n - 1
        ? { from: from(index), to: from(index + 1) }
        : { from: to(index - 1), to: to(index) };
    const gap =
      index < n - 1
        ? doc.sliceString(to(index), from(index + 1))
        : doc.sliceString(to(index - 1), from(index));
    at = from(slot);
    paste = block + gap;
    offset = 0;
  }
  const move = state.changes([cut, { from: at, insert: paste }]);
  const blockStart = move.mapPos(at, -1) + offset;
  /** Map a position through the cut and paste; the item's own text goes with it. */
  const moved = (p: number) =>
    p >= from(index) && p <= to(index)
      ? blockStart + (p - from(index))
      : move.mapPos(p, down ? -1 : 1);

  // Renumber the list in its new order.
  const renumber: ChangeSpec[] = [];
  if (numbers) {
    const order = blocks.map((_, k) => k);
    order.splice(index, 1);
    order.splice(down ? slot - 1 : slot, 0, index);
    const first = parseInt(doc.sliceString(numbers[0]!.from, numbers[0]!.to)) || 1;
    order.forEach((k, place) => {
      const mark = numbers[k]!;
      const old = doc.sliceString(mark.from, mark.to);
      const text = `${first + place}${old.slice(-1)}`;
      const start = moved(mark.from);
      if (text !== old) renumber.push({ from: start, to: start + old.length, insert: text });
    });
  }
  const numbered = ChangeSet.of(renumber, move.newLength);
  const map = (p: number) => numbered.mapPos(moved(p), 1);

  return {
    changes: move.compose(numbered),
    selection: EditorSelection.create(
      state.selection.ranges.map((r) => EditorSelection.range(map(r.anchor), map(r.head))),
      state.selection.mainIndex,
    ),
    userEvent: 'move.line',
  };
}

/**
 * Move up/down (Alt+↑/↓ and the format bar). On a list item line, the item
 * moves past its neighbour with its sub-items, and stays put at either end
 * of its list. Anywhere else, the selected lines move.
 */
function moveItem(dir: -1 | 1): StateCommand {
  const moveLines = dir < 0 ? moveLineUp : moveLineDown;
  return (target) => {
    const { state, dispatch } = target;
    if (state.readOnly) return false;
    const { main, ranges } = state.selection;
    if (
      ranges.length === 1 &&
      state.doc.lineAt(main.from).number === state.doc.lineAt(main.to).number
    ) {
      const siblings = listSiblings(state, main.head);
      if (siblings) {
        const slot = dir < 0 ? siblings.index - 1 : siblings.index + 2;
        const spec = moveListItem(state, main.head, slot);
        if (spec) dispatch(state.update(spec, { scrollIntoView: true }));
        return true;
      }
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
