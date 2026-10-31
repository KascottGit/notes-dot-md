import { describe, expect, it } from 'vitest';
import { findTags, TAG_WORD } from './tags';

const tags = (text: string) => findTags(text).map((t) => text.slice(t.from, t.to));

describe('tags', () => {
  it('finds tags at the start of a line or after a space', () => {
    expect(tags('#school and #work-notes, #a/b_c.')).toEqual(['#school', '#work-notes', '#a/b_c']);
    expect(tags('#æøå #日本')).toEqual(['#æøå', '#日本']);
  });

  it('skips numbers, anchors and words with # inside', () => {
    expect(tags('issue #12, see a#b or example.com/#top or # heading')).toEqual([]);
    expect(tags('#2026plan')).toEqual(['#2026plan']);
  });

  it('matches a whole word', () => {
    expect(TAG_WORD.test('#school')).toBe(true);
    expect(TAG_WORD.test('#12')).toBe(false);
    expect(TAG_WORD.test('#a!')).toBe(false);
  });
});
