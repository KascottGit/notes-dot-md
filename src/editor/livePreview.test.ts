import { EditorState } from '@codemirror/state';
import type { Decoration } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { markdownSupport } from './language';
import { buildDecorations } from './livePreview';

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

  it('tables stay plain monospace text', () => {
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
