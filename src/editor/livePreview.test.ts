import { EditorState } from '@codemirror/state';
import type { Decoration } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { markdownSupport } from './language';
import { buildDecorations, tableAwareInput, tableDecorations } from './livePreview';

interface Seen {
  from: number;
  to: number;
  /** Widget class name, CSS class, or 'hidden'. */
  kind: string;
  href?: string;
}

function render(doc: string, activeLines: number[] = []) {
  const state = EditorState.create({ doc, extensions: [markdownSupport()] });
  const { decorations, atomic } = buildDecorations(state, 0, doc.length, new Set(activeLines));
  const list = (set: typeof decorations) => {
    const seen: Seen[] = [];
    set.between(0, doc.length, (from, to, value: Decoration) => {
      const spec = value.spec as {
        widget?: object;
        class?: string;
        attributes?: Record<string, string>;
      };
      const kind = spec.widget?.constructor.name ?? spec.class ?? 'hidden';
      seen.push({
        from,
        to,
        kind,
        ...(spec.attributes?.['data-href'] ? { href: spec.attributes['data-href'] } : {}),
      });
    });
    return seen;
  };
  return { all: list(decorations), atomic: list(atomic), state };
}

const has = (seen: Seen[], from: number, to: number, kind: string) =>
  seen.some((s) => s.from === from && s.to === to && s.kind.split(' ').includes(kind));
const hidden = (seen: Seen[]) => seen.filter((s) => s.kind === 'hidden').map((s) => [s.from, s.to]);

describe('headings', () => {
  it('styles the line and hides `# ` when not active', () => {
    const { all } = render('# Title');
    expect(has(all, 0, 0, 'cm-md-h1')).toBe(true);
    expect(hidden(all)).toEqual([[0, 2]]);
  });

  it('shows the marker dimmed on the active line', () => {
    const { all } = render('## Title', [1]);
    expect(has(all, 0, 0, 'cm-md-h2')).toBe(true);
    expect(has(all, 0, 3, 'cm-md-mark')).toBe(true);
    expect(hidden(all)).toEqual([]);
  });

  it('hides closing hashes too', () => {
    const { all } = render('# Title ##');
    expect(hidden(all)).toEqual([
      [0, 2],
      [7, 10],
    ]);
  });
});

describe('inline formatting', () => {
  it('bold, italic, strikethrough and code hide their markers', () => {
    const doc = '**b** *i* ~~s~~ `c`';
    const { all } = render(doc);
    expect(has(all, 0, 5, 'cm-md-strong')).toBe(true);
    expect(has(all, 6, 9, 'cm-md-em')).toBe(true);
    expect(has(all, 10, 15, 'cm-md-strike')).toBe(true);
    expect(has(all, 16, 19, 'cm-md-code')).toBe(true);
    expect(hidden(all)).toEqual([
      [0, 2],
      [3, 5],
      [6, 7],
      [8, 9],
      [10, 12],
      [13, 15],
      [16, 17],
      [18, 19],
    ]);
  });

  it('underscore italics work too', () => {
    const { all } = render('_i_');
    expect(has(all, 0, 3, 'cm-md-em')).toBe(true);
  });

  it('markers are only revealed on the lines the selection touches', () => {
    const { all } = render('**a**\n**b**', [2]);
    expect(hidden(all)).toEqual([
      [0, 2],
      [3, 5],
    ]);
    expect(has(all, 6, 8, 'cm-md-mark')).toBe(true);
  });
});

describe('links', () => {
  it('shows only the link text, with the URL to open', () => {
    const doc = '[site](https://example.com)';
    const { all } = render(doc);
    expect(all).toContainEqual({
      from: 1,
      to: 5,
      kind: 'cm-md-link cm-md-link-rendered',
      href: 'https://example.com',
    });
    expect(hidden(all)).toEqual([
      [0, 1],
      [5, doc.length],
    ]);
  });

  it('keeps markers dimmed and the link not tappable on the active line', () => {
    const { all } = render('[site](https://example.com)', [1]);
    expect(all.some((s) => s.kind === 'cm-md-link' && s.href)).toBe(true);
    expect(hidden(all)).toEqual([]);
  });

  it('never makes javascript: links openable', () => {
    const { all } = render('[x](javascript:alert(1))');
    expect(all.some((s) => s.href)).toBe(false);
  });

  it('styles bare URLs', () => {
    const { all } = render('see https://example.com now');
    expect(all.some((s) => s.kind.includes('cm-md-link') && s.href === 'https://example.com')).toBe(
      true,
    );
  });

  it('opens www. links over https', () => {
    const { all } = render('see www.example.com now');
    expect(all.some((s) => s.href === 'https://www.example.com')).toBe(true);
  });

  it('resolves reference links and mutes their definitions', () => {
    const doc = 'see [site][s] and [s]\n\n[S]: https://example.com';
    const { all } = render(doc);
    expect(all).toContainEqual({
      from: 5,
      to: 9,
      kind: 'cm-md-link cm-md-link-rendered',
      href: 'https://example.com',
    });
    expect(all.filter((s) => s.href === 'https://example.com')).toHaveLength(2);
    expect(has(all, doc.indexOf('[S]:'), doc.indexOf('[S]:'), 'cm-md-linkref')).toBe(true);
  });

  it('leaves text in brackets alone when it is not a link', () => {
    const { all } = render('pick [one] or [two][x]');
    expect(hidden(all)).toEqual([]);
    expect(all.some((s) => s.kind.includes('cm-md-link'))).toBe(false);
  });
});

describe('images', () => {
  const doc = 'Look: ![a cat](https://example.com/cat.png) ok';
  const start = doc.indexOf('!');
  const end = doc.indexOf(' ok');

  it('replace the source with the image when not active', () => {
    const { all, atomic } = render(doc);
    expect(has(all, start, end, 'ImageWidget')).toBe(true);
    expect(has(atomic, start, end, 'ImageWidget')).toBe(true);
  });

  it('show the source dimmed with the image after it on the active line', () => {
    const { all } = render(doc, [1]);
    expect(has(all, start, end, 'cm-md-mark')).toBe(true);
    expect(has(all, end, end, 'ImageWidget')).toBe(true);
  });

  it('work as reference images too', () => {
    const { all } = render('![cat][c]\n\n[c]: https://example.com/cat.png');
    expect(has(all, 0, 9, 'ImageWidget')).toBe(true);
  });
});

describe('escapes and entities', () => {
  it('hides the backslash of an escape when not active', () => {
    expect(hidden(render('a \\* b').all)).toEqual([[2, 3]]);
    expect(hidden(render('a \\* b', [1]).all)).toEqual([]);
  });

  it('draws entities as their character when not active', () => {
    expect(has(render('a &amp; b').all, 2, 7, 'EntityWidget')).toBe(true);
    expect(has(render('a &amp; b', [1]).all, 2, 7, 'EntityWidget')).toBe(false);
  });
});

describe('lists and tasks', () => {
  it('draws a bullet for `-` when not active, dims it when active', () => {
    expect(has(render('- a').all, 0, 1, 'BulletWidget')).toBe(true);
    const active = render('- a', [1]).all;
    expect(has(active, 0, 1, 'cm-md-mark')).toBe(true);
    expect(active.some((s) => s.kind === 'BulletWidget')).toBe(false);
  });

  it('keeps numbers visible', () => {
    const { all } = render('1. a\n2. b');
    expect(has(all, 0, 2, 'cm-md-list-number')).toBe(true);
    expect(hidden(all)).toEqual([]);
  });

  it('task checkboxes always render, also on the active line', () => {
    for (const active of [[], [1]]) {
      const { all, atomic } = render('- [ ] buy milk', active);
      expect(has(all, 0, 5, 'CheckboxWidget')).toBe(true);
      expect(has(atomic, 0, 5, 'CheckboxWidget')).toBe(true);
    }
  });

  it('dims and strikes checked tasks', () => {
    const { all } = render('- [x] done');
    expect(has(all, 6, 10, 'cm-md-done')).toBe(true);
    expect(render('- [ ] open').all.some((s) => s.kind === 'cm-md-done')).toBe(false);
  });

  it('in ordered lists keeps the number and only replaces the box', () => {
    const { all } = render('1. [ ] a');
    expect(has(all, 0, 2, 'cm-md-list-number')).toBe(true);
    expect(has(all, 3, 6, 'CheckboxWidget')).toBe(true);
  });
});

describe('blocks', () => {
  it('quotes get a line style and hide `> `', () => {
    const { all } = render('> quoted');
    expect(has(all, 0, 0, 'cm-md-quote')).toBe(true);
    expect(hidden(all)).toEqual([[0, 2]]);
  });

  it('fenced code is a block with fences dimmed, never hidden', () => {
    const doc = '```ts\nconst a = 1;\n```';
    const { all } = render(doc);
    for (const lineStart of [0, 6, 19])
      expect(has(all, lineStart, lineStart, 'cm-md-codeblock')).toBe(true);
    expect(has(all, 0, 3, 'cm-md-mark')).toBe(true);
    expect(hidden(all)).toEqual([]);
  });

  it('does not render markdown inside code', () => {
    const { all } = render('```\n**not bold**\n```');
    expect(all.some((s) => s.kind === 'cm-md-strong')).toBe(false);
  });

  it('draws a rule for `---`, dimmed text on the active line', () => {
    const doc = 'a\n\n---';
    expect(has(render(doc).all, 3, 6, 'RuleWidget')).toBe(true);
    expect(has(render(doc, [3]).all, 3, 6, 'cm-md-mark')).toBe(true);
  });

  it('tables are monospace text here; the table field draws them when not editing', () => {
    const { all } = render('| a | b |\n| - | - |\n| **1** | 2 |');
    expect(has(all, 0, 0, 'cm-md-table')).toBe(true);
    expect(hidden(all)).toEqual([]);
  });
});

describe('frontmatter', () => {
  const doc = '---\ntitle: Plan\ntype: board\n---\n# Heading';

  it('is small and muted, foldable, and always visible', () => {
    const { all } = render(doc, [1]);
    for (const lineStart of [0, 4, 16, 28]) {
      expect(has(all, lineStart, lineStart, 'cm-md-frontmatter')).toBe(true);
    }
    expect(all.some((s) => s.kind === 'FoldToggleWidget' && s.from === 3)).toBe(true);
    // Nothing in the frontmatter is hidden (the heading's `# ` after it is).
    expect(hidden(all).filter(([from]) => from! < 32)).toEqual([]);
  });

  it('ends at the closing `---`, so the rest still renders', () => {
    const { all } = render(doc);
    expect(has(all, 32, 32, 'cm-md-h1')).toBe(true);
  });

  it('a rule at the top is not frontmatter', () => {
    const { all } = render('---\n\nText');
    expect(all.some((s) => s.kind.includes('cm-md-frontmatter'))).toBe(false);
  });
});

describe('golden rule', () => {
  it('rendering never changes the document', () => {
    const doc = '# T\n\n- [ ] a\n- [x] b\n\n**c** [d](https://e.f)\n\n---\n';
    const { state } = render(doc);
    expect(state.doc.toString()).toBe(doc);
  });
});

describe('tables', () => {
  const doc = 'Intro\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nEnd';
  const tableFrom = doc.indexOf('|');
  const tableTo = doc.indexOf('\n\nEnd');

  function tables(asText: { from: number; to: number }[] = [], text = doc, readOnly = false) {
    const state = EditorState.create({
      doc: text,
      extensions: [markdownSupport(), EditorState.readOnly.of(readOnly)],
    });
    const seen: [number, number, string, boolean][] = [];
    tableDecorations(state, asText).between(0, text.length, (from, to, value) => {
      const widget = (value.spec as { widget: { editable: boolean } }).widget;
      seen.push([from, to, widget.constructor.name, widget.editable]);
    });
    return seen;
  }

  it('always draws the whole table as an editable table', () => {
    expect(tables()).toEqual([[tableFrom, tableTo, 'TableWidget', true]]);
  });

  it('is not editable in a read-only note', () => {
    expect(tables([], doc, true)).toEqual([[tableFrom, tableTo, 'TableWidget', false]]);
  });

  it('shows the text after "Edit as text"', () => {
    expect(tables([{ from: tableFrom, to: tableTo }])).toEqual([]);
    expect(tables([{ from: 0, to: 2 }])).toEqual([[tableFrom, tableTo, 'TableWidget', true]]);
  });

  it('leaves tables that share a line with a quote or list marker as text', () => {
    expect(tables([], '> | a | b |\n> | - | - |')).toEqual([]);
  });
});

describe('tags', () => {
  it('styles #tags in text and headings', () => {
    const { all } = render('Plan #school today\n\n## Work #todo');
    expect(has(all, 5, 12, 'cm-md-tag')).toBe(true);
    expect(all.filter((s) => s.kind === 'cm-md-tag')).toHaveLength(2);
  });

  it('leaves code, URLs and numbers alone', () => {
    const { all } = render('`#code` https://x.y/#top #12\n\n```\n#not\n```');
    expect(all.some((s) => s.kind === 'cm-md-tag')).toBe(false);
  });
});

describe('typing next to a table', () => {
  const doc = 'Intro\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nEnd';
  const tableFrom = doc.indexOf('|');
  const tableTo = doc.indexOf('\n\nEnd');

  function type(text: string, at: number, typed = 'x') {
    const state = EditorState.create({ doc: text, extensions: [markdownSupport()] });
    const spec = tableAwareInput(state, at, at, typed);
    if (!spec) return null;
    const next = state.update(spec).state;
    const d = next.doc.toString();
    const head = next.selection.main.head;
    return d.slice(0, head) + '|' + d.slice(head);
  }

  it('puts text typed at the end of a table below it, after a blank line', () => {
    expect(type(doc, tableTo)).toBe(`${doc.slice(0, tableTo)}\n\nx|${doc.slice(tableTo)}`);
  });

  it('puts text typed at the start of a table above it', () => {
    expect(type(doc, tableFrom)).toBe(`${doc.slice(0, tableFrom)}x|\n\n${doc.slice(tableFrom)}`);
  });

  it('keeps a blank line under the table when typing on it', () => {
    expect(type(doc, tableTo + 1)).toBe(`${doc.slice(0, tableTo)}\n\nx|\nEnd`);
    const atEnd = '| a |\n| - |\n| 1 |\n';
    expect(type(atEnd, atEnd.length)).toBe(`${atEnd}\nx|`);
  });

  it('leaves other typing alone', () => {
    expect(type(doc, doc.length)).toBeNull();
    expect(type(doc, 2)).toBeNull();
  });
});
