/**
 * Live preview: draws markdown as formatted text with decorations only.
 * The document is never changed by rendering (SPEC golden rule 1).
 *
 * Reveal rule: syntax markers are hidden, except on the lines the selection
 * touches while the editor has focus. There they show dimmed so they can be
 * edited. Task checkboxes always show as checkboxes.
 */
import { foldedRanges, syntaxTree } from '@codemirror/language';
import {
  Prec,
  StateField,
  type EditorState,
  type Range,
  type TransactionSpec,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  keymap,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { autolinkHref, isOpenable, linkParts, linkReferences, parseTable } from './markdown';
import { findTags } from './tags';
import {
  BulletWidget,
  CheckboxWidget,
  EntityWidget,
  FoldToggleWidget,
  ImageWidget,
  RuleWidget,
} from './widgets';
import { tableLayoutAt, type TableLayout } from './tableEdit';
import { openRequestedCell, showTableText, TableWidget } from './tableWidget';

const hidden = Decoration.replace({});
const dim = Decoration.mark({ class: 'cm-md-mark' });
const markCache = new Map<string, Decoration>();
const mark = (cls: string) => {
  let d = markCache.get(cls);
  if (!d) markCache.set(cls, (d = Decoration.mark({ class: cls })));
  return d;
};
const bullet = Decoration.replace({ widget: new BulletWidget() });
const rule = Decoration.replace({ widget: new RuleWidget() });
const checkbox = (checked: boolean) => Decoration.replace({ widget: new CheckboxWidget(checked) });
const tag = Decoration.mark({ class: 'cm-md-tag' });

/** Where a `#word` is not a tag: code, URLs, link definitions and HTML. */
const NO_TAGS = new Set([
  'InlineCode',
  'FencedCode',
  'CodeBlock',
  'Frontmatter',
  'URL',
  'Autolink',
  'LinkReference',
  'LinkLabel',
  'HTMLBlock',
  'HTMLTag',
  'CommentBlock',
  'Comment',
]);

export interface PreviewDecorations {
  decorations: DecorationSet;
  /** Hidden markers and widgets, which the cursor should skip over. */
  atomic: DecorationSet;
}

/**
 * Decorations for `from`–`to`. `activeLines` are line numbers whose markers
 * stay visible (dimmed). Exported for tests; needs no DOM.
 */
export function buildDecorations(
  state: EditorState,
  from: number,
  to: number,
  activeLines: ReadonlySet<number>,
): PreviewDecorations {
  const { doc } = state;
  const refs = linkReferences(state);
  const decos: Range<Decoration>[] = [];
  const atomic: Range<Decoration>[] = [];
  const lineClasses = new Map<number, Set<string>>();

  const text = (node: { from: number; to: number }) => doc.sliceString(node.from, node.to);
  const isActive = (pos: number) => activeLines.has(doc.lineAt(pos).number);
  /** Include the space after a marker like `#` or `>`. */
  const withSpace = (pos: number) => (doc.sliceString(pos, pos + 1) === ' ' ? pos + 1 : pos);

  const replace = (deco: Decoration, start: number, end: number) => {
    if (start >= end) return;
    // Plugins may not hide line breaks; show such a marker dimmed instead.
    if (doc.lineAt(start).number !== doc.lineAt(end).number) {
      decos.push(dim.range(start, end));
      return;
    }
    decos.push(deco.range(start, end));
    atomic.push(deco.range(start, end));
  };
  /** Hide a marker, or dim it on an active line. */
  const marker = (start: number, end: number) => {
    if (start >= end) return;
    if (isActive(start)) decos.push(dim.range(start, end));
    else replace(hidden, start, end);
  };
  const addLines = (node: { from: number; to: number }, cls: string) => {
    const first = doc.lineAt(Math.max(node.from, from)).number;
    const last = doc.lineAt(Math.min(node.to, to)).number;
    for (let n = first; n <= last; n++) {
      const start = doc.line(n).from;
      let set = lineClasses.get(start);
      if (!set) lineClasses.set(start, (set = new Set()));
      set.add(cls);
    }
  };

  syntaxTree(state).iterate({
    from,
    to,
    enter(ref) {
      const node = ref.node;
      const name = node.name;

      if (/^ATXHeading[1-6]$/.test(name)) {
        addLines(node, `cm-md-h cm-md-h${name.slice(-1)}`);
        return;
      }
      if (name === 'SetextHeading1' || name === 'SetextHeading2') {
        const level = name.slice(-1);
        // Every line but the `===` / `---` underline is heading text.
        const underline = doc.lineAt(node.to);
        addLines(
          { from: node.from, to: Math.max(node.from, underline.from - 1) },
          `cm-md-h cm-md-h${level}`,
        );
        return;
      }

      switch (name) {
        case 'HeaderMark':
          if (node.parent?.name.startsWith('Setext')) decos.push(dim.range(node.from, node.to));
          else if (node.prevSibling) {
            // Closing `#`s, as in `# Title ##`: hide them with the space before.
            const start =
              doc.sliceString(node.from - 1, node.from) === ' ' ? node.from - 1 : node.from;
            marker(start, node.to);
          } else marker(node.from, withSpace(node.to));
          return;

        case 'StrongEmphasis':
          decos.push(mark('cm-md-strong').range(node.from, node.to));
          return;
        case 'Emphasis':
          decos.push(mark('cm-md-em').range(node.from, node.to));
          return;
        case 'Strikethrough':
          decos.push(mark('cm-md-strike').range(node.from, node.to));
          return;
        case 'EmphasisMark':
        case 'StrikethroughMark':
          marker(node.from, node.to);
          return;

        case 'InlineCode':
          decos.push(mark('cm-md-code').range(node.from, node.to));
          return;
        case 'CodeMark':
          if (node.parent?.name === 'InlineCode') marker(node.from, node.to);
          else decos.push(dim.range(node.from, node.to)); // ``` fences stay visible, dimmed.
          return;
        case 'CodeInfo':
          decos.push(dim.range(node.from, node.to));
          return;

        case 'Link':
          link(node);
          return;
        case 'Image':
          image(node);
          return false;
        case 'URL': {
          const parent = node.parent?.name;
          if (parent === 'Link' || parent === 'Image' || parent === 'LinkReference') return;
          linkText(node.from, node.to, autolinkHref(text(node))); // Bare URL or <autolink>
          return;
        }
        case 'LinkReference':
          addLines(node, 'cm-md-linkref'); // `[label]: url`, the target of reference links
          return false;
        case 'Escape':
          marker(node.from, node.from + 1); // `\*` shows as `*`
          return;
        case 'Entity':
          if (!isActive(node.from)) {
            replace(
              Decoration.replace({ widget: new EntityWidget(text(node)) }),
              node.from,
              node.to,
            );
          }
          return;

        case 'ListMark':
          listMark(node);
          return;
        case 'Task':
          task(node);
          return;

        case 'Blockquote':
          addLines(node, 'cm-md-quote');
          return;
        case 'QuoteMark':
          marker(node.from, withSpace(node.to));
          return;

        case 'FencedCode':
          addLines(node, 'cm-md-codeblock');
          addLines({ from: node.from, to: node.from }, 'cm-md-codeblock-first');
          addLines({ from: node.to, to: node.to }, 'cm-md-codeblock-last');
          return;
        case 'CodeBlock':
          addLines(node, 'cm-md-codeblock');
          return;

        case 'HorizontalRule':
          if (isActive(node.from)) decos.push(dim.range(node.from, node.to));
          else replace(rule, node.from, node.to);
          return;

        case 'Table':
          // Text while editing; otherwise the table field draws it (tableField below).
          addLines(node, 'cm-md-table');
          return false;

        case 'Frontmatter':
          frontmatter(node);
          return false;
      }
      return;
    },
  });

  function linkText(start: number, end: number, url: string | null) {
    const rendered = !isActive(start);
    const attrs: Record<string, string> = {};
    if (isOpenable(url)) attrs['data-href'] = url;
    decos.push(
      Decoration.mark({
        class: rendered ? 'cm-md-link cm-md-link-rendered' : 'cm-md-link',
        attributes: attrs,
      }).range(start, end),
    );
  }

  /**
   * `[text](url)` or `[text][label]`: show only `text`, styled as a link.
   * `[text]` with no matching `[label]: url` is just text in brackets.
   */
  function link(node: SyntaxNode) {
    const parts = linkParts(state, node, refs);
    if (!parts || parts.textTo <= parts.textFrom) return;
    linkText(parts.textFrom, parts.textTo, parts.href);
    marker(node.from, parts.textFrom);
    marker(parts.textTo, node.to); // `](url "title")` or `][label]`
  }

  /** `![alt](url)`: the image. On the active line, the source (dimmed) with the image after it. */
  function image(node: SyntaxNode) {
    const parts = linkParts(state, node, refs);
    if (!parts) return;
    const widget = new ImageWidget(parts.href, doc.sliceString(parts.textFrom, parts.textTo));
    if (isActive(node.from)) {
      decos.push(dim.range(node.from, node.to));
      decos.push(Decoration.widget({ widget, side: 1 }).range(node.to));
    } else {
      replace(Decoration.replace({ widget }), node.from, node.to);
    }
  }

  function listMark(node: SyntaxNode) {
    const item = node.parent;
    const ordered = item?.parent?.name === 'OrderedList';
    const taskNode = item?.getChild('Task');
    if (ordered) {
      decos.push(mark('cm-md-list-number').range(node.from, node.to));
      return;
    }
    if (taskNode) {
      // `- [ ]` becomes one checkbox, on every line, active or not.
      const box = taskNode.getChild('TaskMarker');
      if (box) replace(checkbox(/x/i.test(text(box))), node.from, box.to);
      return;
    }
    if (isActive(node.from)) decos.push(dim.range(node.from, node.to));
    else replace(bullet, node.from, node.to);
  }

  function task(node: SyntaxNode) {
    const box = node.getChild('TaskMarker');
    if (!box) return;
    const checked = /x/i.test(text(box));
    addLines(node, 'cm-md-task');
    // In ordered lists the number stays and only `[ ]` becomes a checkbox.
    if (node.parent?.parent?.name === 'OrderedList') replace(checkbox(checked), box.from, box.to);
    if (checked && withSpace(box.to) < node.to) {
      decos.push(mark('cm-md-done').range(withSpace(box.to), node.to));
    }
  }

  function frontmatter(node: SyntaxNode) {
    addLines(node, 'cm-md-frontmatter');
    const first = doc.lineAt(node.from);
    if (node.to <= first.to) return;
    let folded = false;
    foldedRanges(state).between(first.to, node.to, (a, b) => {
      if (a === first.to && b === node.to) folded = true;
    });
    decos.push(
      Decoration.widget({ widget: new FoldToggleWidget(first.to, node.to, folded), side: 1 }).range(
        first.to,
      ),
    );
  }

  // `#tags`, in the accent color.
  const tree = syntaxTree(state);
  for (let pos = from; pos <= to;) {
    const line = doc.lineAt(pos);
    for (const t of findTags(line.text)) {
      const at = line.from + t.from;
      let excluded = false;
      for (let n: SyntaxNode | null = tree.resolveInner(at, 1); n; n = n.parent) {
        if (NO_TAGS.has(n.name)) excluded = true;
      }
      if (!excluded) decos.push(tag.range(at, line.from + t.to));
    }
    pos = line.to + 1;
  }

  for (const [start, classes] of lineClasses) {
    decos.push(Decoration.line({ class: [...classes].join(' ') }).range(start));
  }

  return {
    decorations: Decoration.set(decos, true),
    atomic: Decoration.set(atomic, true),
  };
}

/** Lines touched by the selection, or none when the editor doesn't have focus. */
function activeLines(view: EditorView): Set<number> {
  const lines = new Set<number>();
  if (!view.hasFocus) return lines;
  for (const r of view.state.selection.ranges) {
    const last = view.state.doc.lineAt(r.to).number;
    for (let n = view.state.doc.lineAt(r.from).number; n <= last; n++) lines.add(n);
  }
  return lines;
}

const previewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    atomic: DecorationSet;

    constructor(view: EditorView) {
      ({ decorations: this.decorations, atomic: this.atomic } = this.build(view));
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        update.focusChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state) ||
        foldedRanges(update.startState) !== foldedRanges(update.state)
      ) {
        ({ decorations: this.decorations, atomic: this.atomic } = this.build(update.view));
      }
    }

    build(view: EditorView): PreviewDecorations {
      const { from, to } = view.viewport;
      return buildDecorations(view.state, from, to, activeLines(view));
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic ?? Decoration.none),
  },
);

// ------------------------------------------------------------------ tables

/**
 * Tables shown as their markdown lines after "Edit as text", until the
 * cursor leaves them. Ranges move with edits.
 */
const tableTextField = StateField.define<readonly { from: number; to: number }[]>({
  create: () => [],
  update(value, tr) {
    let next = tr.docChanged
      ? value.map((r) => ({ from: tr.changes.mapPos(r.from, 1), to: tr.changes.mapPos(r.to, -1) }))
      : value;
    for (const effect of tr.effects) if (effect.is(showTableText)) next = [...next, effect.value];
    if (next.length > 0 && (tr.selection || tr.docChanged)) {
      const { ranges } = tr.state.selection;
      next = next.filter((r) => ranges.some((s) => s.from <= r.to && s.to >= r.from));
    }
    return next;
  },
});

/** Blocks that can hold tables; the rest of the tree is skipped when looking for them. */
const TABLE_CONTAINERS = new Set([
  'Document',
  'Blockquote',
  'BulletList',
  'OrderedList',
  'ListItem',
]);

/**
 * Tables drawn as tables (edited cell by cell, tableWidget.ts), except those
 * shown as text after "Edit as text" (styled by the view plugin then).
 * Whole-line replacements must come from a state field, not a view plugin.
 * Exported for tests; needs no DOM.
 */
export function tableDecorations(
  state: EditorState,
  asText: readonly { from: number; to: number }[],
): DecorationSet {
  const { doc } = state;
  const refs = linkReferences(state);
  const decos: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter(ref) {
      if (ref.name !== 'Table') return TABLE_CONTAINERS.has(ref.name);
      const first = doc.lineAt(ref.from);
      const end = doc.lineAt(ref.to);
      const last = end.from === ref.to && ref.to > ref.from ? doc.line(end.number - 1) : end;
      // Only tables that start their line (not after `> ` or `- `) can be replaced whole.
      if (doc.sliceString(first.from, ref.from).trim() !== '') return false;
      const text = asText.some((r) => r.from <= last.to && r.to >= first.from);
      const table = text ? null : parseTable(state, ref.node, refs);
      if (table) {
        const widget = new TableWidget(table, !state.readOnly);
        decos.push(Decoration.replace({ widget, block: true }).range(first.from, last.to));
      }
      return false;
    },
  });
  return Decoration.set(decos);
}

const tableField = StateField.define<DecorationSet>({
  create: (state) => tableDecorations(state, []),
  update(value, tr) {
    const before = tr.startState.field(tableTextField);
    const after = tr.state.field(tableTextField);
    if (
      tr.docChanged ||
      before !== after ||
      tr.startState.readOnly !== tr.state.readOnly ||
      syntaxTree(tr.startState) !== syntaxTree(tr.state)
    ) {
      return tableDecorations(tr.state, after);
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** The table drawn as a table (not as text) whose lines hold `pos`, if any. */
function drawnTableAt(state: EditorState, pos: number): TableLayout | null {
  const layout = tableLayoutAt(state, pos);
  if (!layout || pos < layout.from || pos > layout.to) return null;
  const header = state.doc.sliceString(layout.from, layout.header.to);
  // Like tableDecorations: tables after `> ` or a list marker stay text.
  if (/^\s*(?:>|[-*+]\s|\d+[.)]\s)/.test(header)) return null;
  const asText = state.field(tableTextField, false) ?? [];
  if (asText.some((r) => r.from <= layout.to && r.to >= layout.from)) return null;
  return layout;
}

/**
 * In markdown a table runs on until a blank line, so text typed right under
 * it would become a row. Typing at the table's edge goes before or after it
 * instead, and typing on the line right under it keeps a blank line between.
 */
export function tableAwareInput(
  state: EditorState,
  from: number,
  to: number,
  text: string,
): TransactionSpec | null {
  if (from !== to || state.readOnly) return null;
  const put = (at: number, insert: string, cursor: number): TransactionSpec => ({
    changes: { from: at, insert },
    selection: { anchor: cursor },
    scrollIntoView: true,
    userEvent: 'input.type',
  });
  const table = drawnTableAt(state, from);
  if (table) {
    return from <= table.from
      ? put(table.from, `${text}\n\n`, table.from + text.length)
      : put(table.to, `\n\n${text}`, table.to + 2 + text.length);
  }
  const line = state.doc.lineAt(from);
  const above = line.number > 1 ? drawnTableAt(state, line.from - 1) : null;
  if (above && above.to === line.from - 1 && line.text.trim() === '') {
    return put(line.from, `\n${text}`, line.from + 1 + text.length);
  }
  return null;
}

const keepTablesApart = [
  EditorView.inputHandler.of((view, from, to, text) => {
    const spec = tableAwareInput(view.state, from, to, text);
    if (spec) view.dispatch(spec);
    return spec !== null;
  }),
  // Enter at the end of a table starts a paragraph below it, after a blank line.
  Prec.high(
    keymap.of([
      {
        key: 'Enter',
        run: (view) => {
          const { main } = view.state.selection;
          const table = main.empty ? drawnTableAt(view.state, main.head) : null;
          if (!table || main.head !== table.to || view.state.readOnly) return false;
          view.dispatch({
            changes: { from: table.to, insert: '\n\n' },
            selection: { anchor: table.to + 2 },
            scrollIntoView: true,
            userEvent: 'input',
          });
          return true;
        },
      },
    ]),
  ),
];

function openLink(url: string) {
  if (isOpenable(url)) window.open(url, '_blank', 'noopener,noreferrer');
}

/** Ctrl/Cmd+click opens a link anywhere; a tap opens a rendered (not active) link. */
const linkHandlers = (() => {
  let touch: { x: number; y: number; href: string } | null = null;
  return EditorView.domEventHandlers({
    mousedown(event) {
      const el = (event.target as Element | null)?.closest?.('[data-href]');
      if (!el || !(event.ctrlKey || event.metaKey)) return false;
      event.preventDefault();
      openLink(el.getAttribute('data-href') ?? '');
      return true;
    },
    touchstart(event) {
      const el = (event.target as Element | null)?.closest?.('.cm-md-link-rendered[data-href]');
      const t = event.touches[0];
      touch =
        el && t ? { x: t.clientX, y: t.clientY, href: el.getAttribute('data-href') ?? '' } : null;
      return false;
    },
    touchend(event) {
      const start = touch;
      touch = null;
      const t = event.changedTouches[0];
      if (!start || !t || Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10) return false;
      event.preventDefault(); // Don't place the caret or open the keyboard.
      openLink(start.href);
      return true;
    },
  });
})();

const previewTheme = EditorView.theme({
  '.cm-md-mark': { color: 'var(--text-muted)', opacity: '0.75' },

  '.cm-line.cm-md-h': {
    fontFamily: 'var(--font-heading)',
    fontWeight: '650',
    letterSpacing: '-0.01em',
    lineHeight: '1.3',
  },
  '.cm-line.cm-md-h1': { fontSize: '1.6em', paddingTop: '0.5em' },
  '.cm-line.cm-md-h2': { fontSize: '1.35em', paddingTop: '0.4em' },
  '.cm-line.cm-md-h3': { fontSize: '1.2em', paddingTop: '0.3em' },
  '.cm-line.cm-md-h4': { fontSize: '1.05em' },
  '.cm-line.cm-md-h5': { fontSize: '1em' },
  '.cm-line.cm-md-h6': { fontSize: '0.95em', color: 'var(--text-muted)' },

  '.cm-md-strong': { fontWeight: '700' },
  '.cm-md-em': { fontStyle: 'italic' },
  '.cm-md-strike': { textDecoration: 'line-through' },
  '.cm-md-code': {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.9em',
    backgroundColor: 'var(--code-bg)',
    borderRadius: '4px',
    padding: '0.1em 0.25em',
  },

  '.cm-md-link': { color: 'var(--accent)' },
  '.cm-md-link-rendered': { textDecoration: 'underline', textUnderlineOffset: '2px' },

  '.cm-md-bullet': {
    display: 'inline-block',
    width: '1ch',
    color: 'var(--text-muted)',
    textAlign: 'center',
  },
  '.cm-md-list-number': { color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' },

  '.cm-md-checkbox': {
    position: 'relative',
    display: 'inline-block',
    boxSizing: 'border-box',
    width: '1.05em',
    height: '1.05em',
    marginRight: '0.15em',
    verticalAlign: '-0.17em',
    border: '2px solid var(--text-muted)',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  // A 44px touch target around the small box.
  '.cm-md-checkbox::after': {
    content: '""',
    position: 'absolute',
    inset: '-13px',
  },
  '.cm-md-checkbox[aria-checked="true"]': {
    backgroundColor: 'var(--accent)',
    borderColor: 'var(--accent)',
  },
  '.cm-md-checkbox[aria-checked="true"]::before': {
    content: '""',
    position: 'absolute',
    left: '28%',
    top: '8%',
    width: '30%',
    height: '58%',
    border: 'solid var(--on-accent)',
    borderWidth: '0 2px 2px 0',
    transform: 'rotate(45deg)',
  },
  '.cm-md-tag': {
    padding: '0 0.35em',
    borderRadius: '6px',
    backgroundColor: 'color-mix(in srgb, var(--accent) 14%, transparent)',
    color: 'var(--accent)',
    fontFamily: 'var(--font-ui)',
    fontSize: '0.85em',
    fontWeight: '500',
  },
  '.cm-md-done': { color: 'var(--text-muted)', textDecoration: 'line-through' },

  '.cm-line.cm-md-quote': {
    borderLeft: '3px solid var(--border)',
    paddingLeft: '12px',
    color: 'var(--text-muted)',
  },

  '.cm-line.cm-md-codeblock': {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.9em',
    backgroundColor: 'var(--code-bg)',
    paddingLeft: '12px',
    paddingRight: '12px',
  },
  '.cm-line.cm-md-codeblock-first': { borderRadius: '6px 6px 0 0', paddingTop: '4px' },
  '.cm-line.cm-md-codeblock-last': { borderRadius: '0 0 6px 6px', paddingBottom: '4px' },

  '.cm-md-rule': {
    display: 'inline-block',
    width: '100%',
    verticalAlign: 'middle',
    borderTop: '2px solid var(--border)',
  },

  '.cm-line.cm-md-table': { fontFamily: 'var(--font-mono)', fontSize: '0.9em' },
  '.cm-md-table-widget': {
    margin: '6px 2px 6px 6px',
  },
  // The table with a "+" bar to its right and one below it, as wide as the table.
  '.cm-md-table-grid': {
    display: 'inline-grid',
    gridTemplateColumns: 'minmax(0, auto) auto',
    gap: '4px',
    maxWidth: '100%',
    verticalAlign: 'top',
  },
  '.cm-md-table-scroll': {
    minWidth: '0',
    overflowX: 'auto',
  },
  '.cm-md-table-widget table': {
    // Whole words: a wide table scrolls sideways instead of breaking them.
    wordBreak: 'normal',
    overflowWrap: 'normal',
    borderCollapse: 'collapse',
    fontSize: '0.95em',
    lineHeight: '1.5',
  },
  '.cm-md-table-widget th, .cm-md-table-widget td': {
    // Room to type in a new, empty table.
    minWidth: '4em',
    padding: '6px 12px',
    border: '1px solid var(--border)',
    textAlign: 'start',
    verticalAlign: 'top',
  },
  '.cm-md-table-widget th': {
    backgroundColor: 'var(--bg-muted)',
    fontFamily: 'var(--font-heading)',
    fontWeight: '600',
  },
  '.cm-md-table-widget.editable th, .cm-md-table-widget.editable td': { cursor: 'text' },
  // Empty cells keep a line's height.
  '.cm-md-table-widget th:empty::before, .cm-md-table-widget td:empty::before': {
    content: '"\\200b"',
  },
  '.cm-md-table-widget .cm-md-cell-editing': {
    outline: '2px solid var(--accent)',
    outlineOffset: '-2px',
  },
  '.cm-md-cell-input': {
    display: 'block',
    width: '100%',
    minWidth: '2em',
    margin: '0',
    padding: '0',
    border: '0',
    outline: 'none',
    resize: 'none',
    overflow: 'hidden',
    background: 'transparent',
    color: 'inherit',
    font: 'inherit',
    lineHeight: 'inherit',
    textAlign: 'inherit',
  },
  '.cm-md-table-add': {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0',
    border: '0',
    borderRadius: '6px',
    backgroundColor: 'var(--bg-muted)',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    opacity: '0',
    transition: 'opacity 120ms ease, background-color 120ms ease, color 120ms ease',
  },
  // A bigger target than the thin bar.
  '.cm-md-table-add::after': { content: '""', position: 'absolute', inset: '-8px' },
  '.cm-md-table-add:hover': { backgroundColor: 'var(--selection)', color: 'var(--text)' },
  '.cm-md-table-add-col': { gridColumn: '2', gridRow: '1', width: '22px' },
  '.cm-md-table-add-row': { gridColumn: '1', gridRow: '2', height: '22px' },
  // Shown on hover with a mouse, and while a cell is being edited.
  '@media (hover: hover) and (pointer: fine)': {
    '.cm-md-table-widget:hover .cm-md-table-add': { opacity: '1' },
  },
  '.cm-md-table-widget.editing .cm-md-table-add': { opacity: '1' },
  // Touch screens have no hover: the bars take no room until a cell is edited.
  '@media (hover: none), (pointer: coarse)': {
    '.cm-md-table-widget:not(.editing) .cm-md-table-add': { display: 'none' },
  },
  '.cm-md-table-tools': {
    display: 'none',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '2px',
    marginTop: '2px',
  },
  '.cm-md-table-widget.editing .cm-md-table-tools': { display: 'flex' },
  '.cm-md-table-tools-gap': { width: '8px' },
  '.cm-md-table-tool': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '44px',
    height: '44px',
    padding: '0',
    border: '0',
    borderRadius: '8px',
    background: 'none',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    transition: 'background-color 120ms ease, color 120ms ease',
  },
  '.cm-md-table-tool:hover:not(:disabled)': {
    backgroundColor: 'var(--bg-muted)',
    color: 'var(--text)',
  },
  '.cm-md-table-tool:disabled': { opacity: '0.4', cursor: 'default' },
  '.cm-md-table-tool.on': { color: 'var(--accent)' },

  '.cm-md-image': {
    maxWidth: '100%',
    maxHeight: '24em',
    verticalAlign: 'bottom',
    borderRadius: '4px',
  },
  '.cm-md-image-missing': {
    display: 'inline-block',
    padding: '0 6px',
    border: '1px dashed var(--border)',
    borderRadius: '4px',
    color: 'var(--text-muted)',
    fontSize: '0.9em',
  },

  '.cm-line.cm-md-linkref': {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.85em',
    color: 'var(--text-muted)',
  },

  '.cm-line.cm-md-frontmatter': {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.85em',
    color: 'var(--text-muted)',
  },
  '.cm-md-fold': {
    marginLeft: '8px',
    padding: '0 6px',
    border: '0',
    borderRadius: '4px',
    background: 'none',
    color: 'var(--text-muted)',
    font: 'inherit',
    cursor: 'pointer',
  },
  '.cm-foldPlaceholder': {
    border: '0',
    background: 'none',
    color: 'var(--text-muted)',
  },
});

export function livePreview() {
  return [
    tableTextField,
    tableField,
    keepTablesApart,
    openRequestedCell,
    previewPlugin,
    linkHandlers,
    previewTheme,
  ];
}
