/**
 * Format commands, shared by the format bar and keyboard shortcuts.
 * They edit the markdown text directly, and every one toggles.
 * No Svelte or DOM code here (CLAUDE.md), so they can be unit-tested and
 * reused by the board view.
 */
import { syntaxTree } from '@codemirror/language';
import {
  EditorSelection,
  type ChangeSpec,
  type EditorState,
  type SelectionRange,
  type StateCommand,
  type TransactionSpec,
} from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { editCell, NEW_TABLE } from './tableEdit';

/** Turn a function from state to changes into a command. */
function command(build: (state: EditorState) => TransactionSpec | null): StateCommand {
  return ({ state, dispatch }) => {
    if (state.readOnly) return false;
    const spec = build(state);
    if (!spec) return false;
    dispatch(state.update(spec, { scrollIntoView: true, userEvent: 'input.format' }));
    return true;
  };
}

/** The innermost `name` node that contains from–to. */
function enclosing(state: EditorState, from: number, to: number, name: string): SyntaxNode | null {
  const tree = syntaxTree(state);
  for (const side of [1, -1] as const) {
    for (let n: SyntaxNode | null = tree.resolveInner(from, side); n; n = n.parent) {
      if (n.name === name && n.from <= from && n.to >= to) return n;
    }
  }
  return null;
}

/** Map a selection range through changes, keeping its direction. */
function mapRange(
  state: EditorState,
  range: SelectionRange,
  changes: ChangeSpec[],
  assoc: { from: -1 | 1; to: -1 | 1 } = { from: 1, to: -1 },
): { changes: ChangeSpec[]; range: SelectionRange } {
  const set = state.changes(changes);
  const from = set.mapPos(range.from, assoc.from);
  const to = Math.max(from, set.mapPos(range.to, assoc.to));
  const forward = range.head >= range.anchor;
  return {
    changes,
    range: forward ? EditorSelection.range(from, to) : EditorSelection.range(to, from),
  };
}

// ---------------------------------------------------------------- wrapping

interface WrapFormat {
  mark: string;
  /** Syntax node for text that already has this format. */
  node: string;
}

const BOLD: WrapFormat = { mark: '**', node: 'StrongEmphasis' };
const ITALIC: WrapFormat = { mark: '*', node: 'Emphasis' };
const STRIKE: WrapFormat = { mark: '~~', node: 'Strikethrough' };
const CODE: WrapFormat = { mark: '`', node: 'InlineCode' };

/** Remove the opening and closing markers of a formatted node. */
function unwrapNode(node: SyntaxNode): ChangeSpec[] {
  const open = node.firstChild;
  const close = node.lastChild;
  if (!open || !close || open === close) return [];
  return [
    { from: open.from, to: open.to },
    { from: close.from, to: close.to },
  ];
}

/** The parts of a range on each line, without surrounding whitespace. */
function lineSegments(
  state: EditorState,
  from: number,
  to: number,
): { from: number; to: number }[] {
  const segments = [];
  for (let pos = from; pos <= to;) {
    const line = state.doc.lineAt(pos);
    let start = Math.max(from, line.from);
    let end = Math.min(to, line.to);
    const text = state.doc.sliceString(start, end);
    start += text.length - text.trimStart().length;
    end -= text.length - text.trimEnd().length;
    if (start < end) segments.push({ from: start, to: end });
    pos = line.to + 1;
  }
  return segments;
}

function toggleWrap(format: WrapFormat): StateCommand {
  const { mark } = format;
  return command((state) =>
    state.changeByRange((range) => {
      const { doc } = state;

      if (range.empty) {
        const pos = range.head;
        // Right between empty markers (`**|**`): remove them.
        if (
          doc.sliceString(pos - mark.length, pos) === mark &&
          doc.sliceString(pos, pos + mark.length) === mark
        ) {
          return mapRange(state, range, [{ from: pos - mark.length, to: pos + mark.length }]);
        }
        const node = enclosing(state, pos, pos, format.node);
        if (node) return mapRange(state, range, unwrapNode(node));
        return {
          changes: [{ from: pos, insert: mark + mark }],
          range: EditorSelection.cursor(pos + mark.length),
        };
      }

      // Formatting can't span lines in markdown, so toggle each line's part.
      const segments = lineSegments(state, range.from, range.to);
      if (!segments.length) return { range };
      const nodes = segments.map((s) => enclosing(state, s.from, s.to, format.node));
      if (nodes.every(Boolean)) {
        const seen = new Set<number>();
        const changes = nodes.flatMap((n) => {
          if (seen.has(n!.from)) return [];
          seen.add(n!.from);
          return unwrapNode(n!);
        });
        return mapRange(state, range, changes);
      }
      const changes = segments.flatMap((s, i) =>
        nodes[i]
          ? []
          : [
              { from: s.from, insert: mark },
              { from: s.to, insert: mark },
            ],
      );
      // Keep the selection on the text, inside the new markers.
      const set = state.changes(changes);
      const from = set.mapPos(segments[0]!.from, 1);
      const to = set.mapPos(segments.at(-1)!.to, -1);
      const forward = range.head >= range.anchor;
      return {
        changes,
        range: forward ? EditorSelection.range(from, to) : EditorSelection.range(to, from),
      };
    }),
  );
}

export const toggleBold = toggleWrap(BOLD);
export const toggleItalic = toggleWrap(ITALIC);
export const toggleStrikethrough = toggleWrap(STRIKE);
export const toggleInlineCode = toggleWrap(CODE);

/** `[text](url)` with the cursor in the url; on a link, turn it back into plain text. */
export const toggleLink = command((state) =>
  state.changeByRange((range) => {
    const link = enclosing(state, range.from, range.to, 'Link');
    if (link) {
      const [open, close] = link.getChildren('LinkMark');
      if (open && close) {
        return mapRange(state, range, [
          { from: link.from, to: open.to },
          { from: close.from, to: link.to },
        ]);
      }
    }
    if (range.empty) {
      return {
        changes: [{ from: range.head, insert: '[]()' }],
        range: EditorSelection.cursor(range.head + 3),
      };
    }
    const segment = lineSegments(state, range.from, range.to)[0];
    if (!segment) return { range };
    return {
      changes: [
        { from: segment.from, insert: '[' },
        { from: segment.to, insert: ']()' },
      ],
      range: EditorSelection.cursor(segment.to + 3), // Between the parentheses.
    };
  }),
);

// ---------------------------------------------------------------- line prefixes

type Block =
  { kind: 'heading'; level: number } | { kind: 'bullet' } | { kind: 'task' } | { kind: 'number' };

interface LinePrefix {
  /** End of indentation and `>` markers; block prefixes start here. */
  blockFrom: number;
  /** End of the block prefix (heading or list marker). */
  blockTo: number;
  block: Block | null;
  /** Number of `>` quote markers. */
  quoteDepth: number;
  /** Indentation in front of the block prefix, for numbering nested lists. */
  indent: string;
  number?: number;
}

const PREFIX =
  /^([ \t]*)((?:>[ \t]?)*)([ \t]*)(?:(#{1,6})(?:[ \t]+|$)|([-*+])[ \t]+\[[ xX]\](?:[ \t]+|$)|([-*+])(?:[ \t]+|$)|(\d+)[.)](?:[ \t]+|$))?/;

function parsePrefix(text: string): LinePrefix {
  const m = PREFIX.exec(text)!;
  const blockFrom = m[1]!.length + m[2]!.length + m[3]!.length;
  let block: Block | null = null;
  if (m[4]) block = { kind: 'heading', level: m[4].length };
  else if (m[5]) block = { kind: 'task' };
  else if (m[6]) block = { kind: 'bullet' };
  else if (m[7]) block = { kind: 'number' };
  return {
    blockFrom,
    blockTo: m[0].length,
    block,
    quoteDepth: (m[2]!.match(/>/g) ?? []).length,
    indent: m[1]! + m[3]!,
    ...(m[7] ? { number: Number(m[7]) } : {}),
  };
}

function sameBlock(a: Block | null, b: Block): boolean {
  if (!a || a.kind !== b.kind) return false;
  return a.kind !== 'heading' || (b.kind === 'heading' && a.level === b.level);
}

/** Line numbers touched by any selection range. */
function touchedLines(state: EditorState): number[] {
  const lines = new Set<number>();
  for (const r of state.selection.ranges) {
    const first = state.doc.lineAt(r.from).number;
    let last = state.doc.lineAt(r.to).number;
    // A selection ending at the very start of a line doesn't include that line.
    if (last > first && state.doc.lineAt(r.to).from === r.to) last--;
    for (let n = first; n <= last; n++) lines.add(n);
  }
  return [...lines].sort((a, b) => a - b);
}

/** Lines to format: the non-blank ones, or the single empty line the cursor is on. */
function targetLines(state: EditorState): number[] {
  const lines = touchedLines(state);
  const nonBlank = lines.filter((n) => state.doc.line(n).text.trim() !== '');
  return nonBlank.length ? nonBlank : lines;
}

function prefixFor(block: Block, n: number): string {
  switch (block.kind) {
    case 'heading':
      return '#'.repeat(block.level) + ' ';
    case 'bullet':
      return '- ';
    case 'task':
      return '- [ ] ';
    case 'number':
      return `${n}. `;
  }
}

/**
 * Apply a heading or list prefix to every selected line, or remove it if all
 * lines already have it. Switching list type replaces the old prefix, and
 * numbered lists are renumbered in order.
 */
function toggleBlock(target: Block): StateCommand {
  return command((state) => {
    const lines = targetLines(state);
    const parsed = lines.map((n) => ({
      line: state.doc.line(n),
      prefix: parsePrefix(state.doc.line(n).text),
    }));
    const remove = parsed.every((p) => sameBlock(p.prefix.block, target));

    // Continue numbering from a numbered item right above, at the same indent.
    const counters = new Map<string, number>();
    const first = parsed[0];
    if (target.kind === 'number' && first && first.line.number > 1) {
      const above = parsePrefix(state.doc.line(first.line.number - 1).text);
      if (above.block?.kind === 'number' && above.indent === first.prefix.indent) {
        counters.set(above.indent, above.number!);
      }
    }

    const changes: ChangeSpec[] = [];
    for (const { line, prefix } of parsed) {
      const from = line.from + prefix.blockFrom;
      const to = line.from + prefix.blockTo;
      if (remove) {
        changes.push({ from, to });
        continue;
      }
      // Already the right kind (and not a number to renumber): leave it.
      if (target.kind !== 'number' && sameBlock(prefix.block, target)) continue;
      const n = (counters.get(prefix.indent) ?? 0) + 1;
      counters.set(prefix.indent, n);
      const insert = prefixFor(target, n);
      if (state.doc.sliceString(from, to) !== insert) changes.push({ from, to, insert });
    }
    if (!changes.length) return null;
    return { changes, selection: state.selection.map(state.changes(changes), 1) };
  });
}

export const toggleHeading = (level: 1 | 2 | 3 | 4 | 5 | 6) =>
  toggleBlock({ kind: 'heading', level });
export const toggleBulletList = toggleBlock({ kind: 'bullet' });
export const toggleNumberedList = toggleBlock({ kind: 'number' });
export const toggleChecklist = toggleBlock({ kind: 'task' });

/** Add `> ` to every selected line, or remove one level if all are quoted. */
export const toggleQuote = command((state) => {
  const lines = touchedLines(state);
  const parsed = lines.map((n) => ({
    line: state.doc.line(n),
    prefix: parsePrefix(state.doc.line(n).text),
  }));
  const content = parsed.filter((p) => p.line.text.trim() !== '');
  const remove = (content.length ? content : parsed).every((p) => p.prefix.quoteDepth > 0);

  const changes: ChangeSpec[] = parsed.flatMap(({ line }): ChangeSpec[] => {
    if (remove) {
      const m = /^([ \t]*)>[ \t]?/.exec(line.text);
      return m ? [{ from: line.from + m[1]!.length, to: line.from + m[0].length }] : [];
    }
    if (line.text.trim() === '')
      return parsed.length > 1
        ? [{ from: line.from, insert: '>' }]
        : [{ from: line.from, insert: '> ' }];
    return [{ from: line.from, insert: '> ' }];
  });
  if (!changes.length) return null;
  return { changes, selection: state.selection.map(state.changes(changes), 1) };
});

const FENCE_LINE = /^[ \t]*(```|~~~)/;

/** Wrap the selected lines in ``` fences, or remove the fences around them. */
export const toggleCodeBlock = command((state) => {
  const { doc, selection } = state;
  const main = selection.main;
  const firstLine = doc.lineAt(main.from);
  const block = enclosing(state, firstLine.from, main.to, 'FencedCode');

  if (block) {
    const open = doc.lineAt(block.from);
    const close = doc.lineAt(block.to);
    const changes: ChangeSpec[] = [];
    if (close.number > open.number && FENCE_LINE.test(close.text)) {
      changes.push({ from: close.from - 1, to: close.to });
    }
    changes.push({ from: open.from, to: Math.min(open.to + 1, doc.length) });
    return { changes, selection: selection.map(state.changes(changes)) };
  }

  const endsAtLineStart = main.to > main.from && doc.lineAt(main.to).from === main.to;
  const lastLine = doc.lineAt(endsAtLineStart ? main.to - 1 : main.to);
  const changes = [
    { from: firstLine.from, insert: '```\n' },
    { from: lastLine.to, insert: '\n```' },
  ];
  // Everything selected moves down by the opening fence and stays inside the block.
  const shift = 4;
  const to = Math.min(main.to, lastLine.to) + shift;
  return {
    changes,
    selection: EditorSelection.range(
      main.anchor === main.from ? main.from + shift : to,
      main.anchor === main.from ? to : main.from + shift,
    ),
  };
});

// ------------------------------------------------------------------ tables

/**
 * Add an empty table (a header row and one row, two columns) on its own lines
 * at the cursor, with a blank line before and after it so text around it
 * stays text. The table widget then opens its first header cell for typing.
 */
export const insertTable: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  const { doc } = state;
  const line = doc.lineAt(state.selection.main.head);
  const blank = (n: number) => n >= 1 && n <= doc.lines && doc.line(n).text.trim() === '';
  const empty = line.text.trim() === '';
  // On an empty line the table takes its place; otherwise it goes under the line.
  const from = empty ? line.from : line.to;
  const lead = empty ? (line.number === 1 || blank(line.number - 1) ? '' : '\n') : '\n\n';
  const next = line.number + 1;
  const tail = next > doc.lines ? '\n\n' : blank(next) ? '' : '\n';
  const insert = lead + NEW_TABLE + tail;
  const tableFrom = from + lead.length;
  dispatch(
    state.update({
      changes: { from, to: line.to, insert },
      selection: { anchor: tableFrom + insert.length - lead.length - tail.length },
      annotations: editCell.of({ pos: tableFrom, row: 0, col: 0 }),
      scrollIntoView: true,
      userEvent: 'input.format',
    }),
  );
  return true;
};
