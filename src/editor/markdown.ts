/**
 * Markdown helpers over the syntax tree: links and references, inline
 * content and tables. No DOM (CLAUDE.md), so they can be unit-tested and
 * reused by the board view. Widgets turn the results into elements.
 */
import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { SyntaxNode, Tree } from '@lezer/common';

/** Link targets that may be opened. Anything else (javascript:, relative paths) is not. */
const OPENABLE = /^(?:https?:|mailto:)/i;
/** Image sources that may be loaded. */
const LOADABLE = /^https?:/i;

export const isOpenable = (url: string | null): url is string => !!url && OPENABLE.test(url);
export const isLoadable = (url: string | null): url is string => !!url && LOADABLE.test(url);

/** A bare URL as typed (GFM autolinks): `www.` links get https, emails get mailto. */
export function autolinkHref(text: string): string {
  if (/^www\./i.test(text)) return `https://${text}`;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text) && text.includes('@')) return `mailto:${text}`;
  return text;
}

/** `<url>` in a link destination means the URL without the brackets. */
const destination = (text: string) => text.replace(/^<(.*)>$/, '$1');

/** Labels match case-insensitively, with runs of whitespace as one space. */
const normalizeLabel = (label: string) => label.trim().replace(/\s+/g, ' ').toLowerCase();

/** Blocks that can hold link reference definitions; others are skipped when looking. */
const CONTAINERS = new Set(['Document', 'Blockquote', 'BulletList', 'OrderedList', 'ListItem']);

const referenceCache = new WeakMap<Tree, Map<string, string>>();

/** `[label]: url` definitions in the note, by normalized label. */
export function linkReferences(state: EditorState): Map<string, string> {
  const tree = syntaxTree(state);
  let refs = referenceCache.get(tree);
  if (refs) return refs;
  const found = new Map<string, string>();
  tree.iterate({
    enter(ref) {
      if (ref.name === 'LinkReference') {
        const label = ref.node.getChild('LinkLabel');
        const url = ref.node.getChild('URL');
        const text = label && state.doc.sliceString(label.from + 1, label.to - 1);
        // `[^1]: …` is a footnote, not a link target.
        if (text && url && !text.startsWith('^')) {
          const key = normalizeLabel(text);
          if (!found.has(key)) found.set(key, destination(state.doc.sliceString(url.from, url.to)));
        }
        return false;
      }
      return CONTAINERS.has(ref.name);
    },
  });
  referenceCache.set(tree, (refs = found));
  return refs;
}

export interface LinkParts {
  /** The link text (or image alt text) between the brackets. */
  textFrom: number;
  textTo: number;
  /** Where the link points, or null when it has no usable URL. */
  href: string | null;
}

/**
 * The text range and target of a Link or Image node: inline `[text](url)`,
 * or a reference `[text][label]`, `[label][]` or `[label]`. Null for a
 * reference to a label the note doesn't define: that is plain text in
 * brackets, not a link.
 */
export function linkParts(
  state: EditorState,
  node: SyntaxNode,
  refs: Map<string, string>,
): LinkParts | null {
  const marks = node.getChildren('LinkMark');
  const open = marks[0];
  const close = marks[1];
  if (!open || !close || close.from < open.to) return null;
  const parts = { textFrom: open.to, textTo: close.from };
  const url = node.getChild('URL');
  if (url) return { ...parts, href: destination(state.doc.sliceString(url.from, url.to)) };
  if (marks.some((m) => state.doc.sliceString(m.from, m.to) === '(')) {
    return { ...parts, href: null }; // `[text]()`
  }
  const label = node.getChild('LinkLabel');
  let key = label ? state.doc.sliceString(label.from + 1, label.to - 1) : '';
  if (!key.trim()) key = state.doc.sliceString(open.to, close.from); // `[label][]` or `[label]`
  const href = refs.get(normalizeLabel(key));
  return href === undefined ? null : { ...parts, href };
}

/** Inline content as plain data, for widgets that draw markdown outside the editor text. */
export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong' | 'em' | 'strike'; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string | null; children: Inline[] }
  | { type: 'image'; src: string | null; alt: string }
  /** An HTML entity like `&amp;`, decoded when drawn. */
  | { type: 'entity'; text: string };

const WRAPS: Record<string, 'strong' | 'em' | 'strike'> = {
  StrongEmphasis: 'strong',
  Emphasis: 'em',
  Strikethrough: 'strike',
};
const MARKS = new Set(['EmphasisMark', 'StrikethroughMark', 'CodeMark', 'LinkMark']);

/** The inline content of `node` between `from` and `to`. */
export function parseInline(
  state: EditorState,
  node: SyntaxNode,
  from: number,
  to: number,
  refs: Map<string, string>,
): Inline[] {
  const { doc } = state;
  const out: Inline[] = [];
  let pos = from;
  const text = (a: number, b: number) => {
    if (b > a) out.push({ type: 'text', text: doc.sliceString(a, b) });
  };
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.to <= from || child.from >= to) continue;
    text(pos, child.from);
    pos = child.to;
    const name = child.name;
    const wrap = WRAPS[name];
    if (wrap) {
      out.push({ type: wrap, children: parseInline(state, child, child.from, child.to, refs) });
    } else if (MARKS.has(name)) {
      // Markers are not drawn.
    } else if (name === 'InlineCode') {
      const marks = child.getChildren('CodeMark');
      const start = marks[0]?.to ?? child.from;
      const end = marks.length > 1 ? marks[marks.length - 1]!.from : child.to;
      out.push({ type: 'code', text: doc.sliceString(start, end) });
    } else if (name === 'Link' || name === 'Image') {
      const parts = linkParts(state, child, refs);
      if (!parts) text(child.from, child.to);
      else if (name === 'Image') {
        out.push({
          type: 'image',
          src: parts.href,
          alt: doc.sliceString(parts.textFrom, parts.textTo),
        });
      } else {
        out.push({
          type: 'link',
          href: parts.href,
          children: parseInline(state, child, parts.textFrom, parts.textTo, refs),
        });
      }
    } else if (name === 'URL') {
      const url = doc.sliceString(child.from, child.to);
      out.push({ type: 'link', href: autolinkHref(url), children: [{ type: 'text', text: url }] });
    } else if (name === 'Escape') {
      text(child.from + 1, child.to);
    } else if (name === 'Entity') {
      out.push({ type: 'entity', text: doc.sliceString(child.from, child.to) });
    } else {
      out.push(...parseInline(state, child, child.from, child.to, refs));
    }
  }
  text(pos, to);
  return out;
}

export type Align = 'left' | 'center' | 'right' | null;

export interface Table {
  align: Align[];
  head: Inline[][];
  rows: Inline[][][];
}

/** Column alignment from the `|:--|--:|:-:|` row. */
function parseAlign(row: string): Align[] {
  return row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => {
      const c = cell.trim();
      const left = c.startsWith(':');
      const right = c.endsWith(':');
      return left && right ? 'center' : right ? 'right' : left ? 'left' : null;
    });
}

/** The cells of a header or body row, by the `|` between them (empty cells have no node). */
function rowCells(state: EditorState, row: SyntaxNode, refs: Map<string, string>): Inline[][] {
  const pipes = row.getChildren('TableDelimiter');
  const bounds = [row.from, ...pipes.flatMap((p) => [p.from, p.to]), row.to];
  const cells: Inline[][] = [];
  for (let i = 0; i < bounds.length; i += 2) {
    const from = bounds[i]!;
    const to = bounds[i + 1]!;
    // Leading and trailing pipes have nothing outside them.
    if ((i === 0 || i === bounds.length - 2) && state.doc.sliceString(from, to).trim() === '') {
      continue;
    }
    let cell: SyntaxNode | null = null;
    for (let c = row.firstChild; c; c = c.nextSibling) {
      if (c.name === 'TableCell' && c.from >= from && c.to <= to) cell = c;
    }
    cells.push(cell ? parseInline(state, cell, cell.from, cell.to, refs) : []);
  }
  return cells;
}

/** A GFM table as data. Rows are padded or cut to the header's column count. */
export function parseTable(
  state: EditorState,
  node: SyntaxNode,
  refs: Map<string, string>,
): Table | null {
  const header = node.getChild('TableHeader');
  const delimiter = node.getChild('TableDelimiter');
  if (!header || !delimiter) return null;
  const head = rowCells(state, header, refs);
  const columns = head.length;
  const fit = (cells: Inline[][]) => Array.from({ length: columns }, (_, i) => cells[i] ?? []);
  const align = parseAlign(state.doc.sliceString(delimiter.from, delimiter.to));
  return {
    align: Array.from({ length: columns }, (_, i) => align[i] ?? null),
    head,
    rows: node.getChildren('TableRow').map((row) => fit(rowCells(state, row, refs))),
  };
}
