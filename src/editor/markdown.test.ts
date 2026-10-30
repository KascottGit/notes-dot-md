import { syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { describe, expect, it } from 'vitest';
import { markdownSupport } from './language';
import {
  autolinkHref,
  imageMarkdown,
  linkParts,
  linkReferences,
  parseInline,
  parseTable,
  type Inline,
} from './markdown';

function stateOf(doc: string) {
  return EditorState.create({ doc, extensions: [markdownSupport()] });
}

/** The first node called `name`. */
function find(state: EditorState, name: string): SyntaxNode {
  let found: SyntaxNode | null = null;
  syntaxTree(state).iterate({
    enter(ref) {
      if (found) return false;
      if (ref.name === name) found = ref.node;
      return undefined;
    },
  });
  if (!found) throw new Error(`no ${name}`);
  return found;
}

/** The target of the first link (or image), or null when it isn't one. */
function hrefOf(doc: string, name = 'Link') {
  const state = stateOf(doc);
  const parts = linkParts(state, find(state, name), linkReferences(state));
  return parts && { href: parts.href, text: doc.slice(parts.textFrom, parts.textTo) };
}

describe('links', () => {
  it('reads inline links, with or without angle brackets', () => {
    expect(hrefOf('[a](https://x.y "t")')).toEqual({ href: 'https://x.y', text: 'a' });
    expect(hrefOf('[a](<https://x.y/b c>)')).toEqual({ href: 'https://x.y/b c', text: 'a' });
    expect(hrefOf('[a]()')).toEqual({ href: null, text: 'a' });
  });

  it('resolves full, collapsed and shortcut references, ignoring case', () => {
    const defs = '\n\n[Ref  One]: https://one.example\n[two]: <https://two.example>';
    expect(hrefOf('[a][ref one]' + defs)).toEqual({ href: 'https://one.example', text: 'a' });
    expect(hrefOf('[two][]' + defs)).toEqual({ href: 'https://two.example', text: 'two' });
    expect(hrefOf('[TWO]' + defs)).toEqual({ href: 'https://two.example', text: 'TWO' });
  });

  it('is not a link when the label is not defined, or is a footnote', () => {
    expect(hrefOf('just [brackets] here')).toBeNull();
    expect(hrefOf('[a][missing]')).toBeNull();
    expect(hrefOf('see [^1]\n\n[^1]: the note')).toBeNull();
  });

  it('keeps the first definition of a label', () => {
    expect(hrefOf('[x]\n\n[x]: https://first.example\n[x]: https://second.example')!.href).toBe(
      'https://first.example',
    );
  });

  it('reads images the same way', () => {
    expect(hrefOf('![a cat](https://x.y/c.png)', 'Image')).toEqual({
      href: 'https://x.y/c.png',
      text: 'a cat',
    });
  });

  it('turns bare www. links and emails into openable URLs', () => {
    expect(autolinkHref('www.example.com')).toBe('https://www.example.com');
    expect(autolinkHref('me@example.com')).toBe('mailto:me@example.com');
    expect(autolinkHref('https://example.com')).toBe('https://example.com');
  });
});

describe('parseInline', () => {
  const inline = (doc: string): Inline[] => {
    const state = stateOf(doc);
    const para = find(state, 'Paragraph');
    return parseInline(state, para, para.from, para.to, linkReferences(state));
  };

  it('reads formatting, without its markers', () => {
    expect(inline('a **b *c*** ~~d~~ `e`')).toEqual([
      { type: 'text', text: 'a ' },
      {
        type: 'strong',
        children: [
          { type: 'text', text: 'b ' },
          { type: 'em', children: [{ type: 'text', text: 'c' }] },
        ],
      },
      { type: 'text', text: ' ' },
      { type: 'strike', children: [{ type: 'text', text: 'd' }] },
      { type: 'text', text: ' ' },
      { type: 'code', text: 'e' },
    ]);
  });

  it('reads links, images, escapes and entities', () => {
    expect(inline('[**a**](https://x.y) ![i](https://x.y/i.png) \\* &amp;')).toEqual([
      {
        type: 'link',
        href: 'https://x.y',
        children: [{ type: 'strong', children: [{ type: 'text', text: 'a' }] }],
      },
      { type: 'text', text: ' ' },
      { type: 'image', src: 'https://x.y/i.png', alt: 'i' },
      { type: 'text', text: ' ' },
      { type: 'text', text: '*' },
      { type: 'text', text: ' ' },
      { type: 'entity', text: '&amp;' },
    ]);
  });

  it('keeps undefined references as text', () => {
    expect(inline('[a] b')).toEqual([
      { type: 'text', text: '[a]' },
      { type: 'text', text: ' b' },
    ]);
  });
});

describe('parseTable', () => {
  const table = (doc: string) => {
    const state = stateOf(doc);
    return parseTable(state, find(state, 'Table'), linkReferences(state));
  };
  const t = (text: string): Inline[] => [{ type: 'text', text }];

  it('reads the header, rows and column alignment', () => {
    expect(table('| a | b | c | d |\n|:--|--:|:-:|---|\n| 1 | **2** | 3 | 4 |')).toEqual({
      align: ['left', 'right', 'center', null],
      head: [t('a'), t('b'), t('c'), t('d')],
      rows: [[t('1'), [{ type: 'strong', children: t('2') }], t('3'), t('4')]],
    });
  });

  it('keeps empty cells in their column, and fits rows to the header', () => {
    expect(table('| a | b | c |\n| - | - | - |\n|  | x |\n| 1 | 2 | 3 | 4 |')!.rows).toEqual([
      [[], t('x'), []],
      [t('1'), t('2'), t('3')],
    ]);
  });

  it('works without outer pipes', () => {
    expect(table('a | b\n--- | ---\n1 | 2')!.rows).toEqual([[t('1'), t('2')]]);
  });

  it('keeps escaped pipes inside a cell', () => {
    expect(table('| a |\n| - |\n| x \\| y |')!.rows).toEqual([
      [
        [
          { type: 'text', text: 'x ' },
          { type: 'text', text: '|' },
          { type: 'text', text: ' y' },
        ],
      ],
    ]);
  });
});

describe('imageMarkdown', () => {
  it('writes an image, escaping brackets in the alt text and spaces or parens in the URL', () => {
    expect(imageMarkdown('https://x.y/a.png', 'A cat')).toBe('![A cat](https://x.y/a.png)');
    expect(imageMarkdown('https://x.y/a b(1).png', 'a [b]\nc')).toBe(
      '![a \\[b\\] c](https://x.y/a%20b%281%29.png)',
    );
  });

  it('round-trips through the parser', () => {
    const doc = imageMarkdown('https://x.y/a b(1).png', 'a [b]');
    const state = stateOf(doc);
    const parts = linkParts(state, find(state, 'Image'), linkReferences(state))!;
    expect(parts.href).toBe('https://x.y/a%20b%281%29.png');
  });
});
