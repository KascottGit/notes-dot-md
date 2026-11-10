import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { markdownSupport } from './language';
import { findHeading, headingAt, outline } from './outline';

const state = (doc: string) => EditorState.create({ doc, extensions: [markdownSupport()] });
const texts = (doc: string) => outline(state(doc)).map((h) => `${h.level} ${h.text}`);

describe('outline', () => {
  it('lists headings in order with their level and line start', () => {
    const doc = '# Plan\n\nText\n\n## Week 1\n\n### Monday\n\n## Week 2\n';
    expect(outline(state(doc))).toEqual([
      { level: 1, text: 'Plan', from: 0 },
      { level: 2, text: 'Week 1', from: 14 },
      { level: 3, text: 'Monday', from: 25 },
      { level: 2, text: 'Week 2', from: 37 },
    ]);
  });

  it('takes setext headings too', () => {
    expect(texts('Title\n=====\n\nPart\n----\n')).toEqual(['1 Title', '2 Part']);
  });

  it('leaves out code blocks, tags and empty headings', () => {
    const doc = '# Real\n\n```\n# not a heading\n```\n\n#tag line\n\n## \n\n    # indented code\n';
    expect(texts(doc)).toEqual(['1 Real']);
  });

  it('shows plain text: no closing hashes, links, emphasis or escapes', () => {
    const doc = '## Plan ##\n\n## **Bold** and [link](https://x.y)\n\n## C# \\#1\n\n## 1. Intro\n';
    expect(texts(doc)).toEqual(['2 Plan', '2 Bold and link', '2 C# #1', '2 1. Intro']);
  });

  it('finds headings in quotes and list items, without their markers', () => {
    expect(texts('> ## Quoted\n\n- ### In a list\n')).toEqual(['2 Quoted', '3 In a list']);
  });

  it('reads a board as columns and cards', () => {
    const doc = '<!-- notes.md:board -->\n\n# Todo\n\n## Card\n#school\n\n# Done\n';
    expect(texts(doc)).toEqual(['1 Todo', '2 Card', '1 Done']);
  });

  it('knows which section a position is in', () => {
    const list = outline(state('Intro\n\n# A\n\ntext\n\n# B\n'));
    expect(headingAt(list, 0)).toBe(-1);
    expect(headingAt(list, 7)).toBe(0);
    expect(headingAt(list, 12)).toBe(0);
    expect(headingAt(list, 19)).toBe(1);
  });

  it('finds a heading again after the text changed', () => {
    const same = outline(state('# A\n\n## B\n\n## B\n'));
    expect(findHeading(same, same[2]!)).toBe(same[2]);
    const before = outline(state('# A\n\n## B\n\n## C\n'));
    const after = outline(state('New line\n\n# A\n\n## B\n\n## C\n'));
    expect(findHeading(after, before[2]!)).toEqual(after[2]);
    expect(findHeading(after, { level: 2, text: 'Gone', from: 0 })).toBeNull();
  });
});
