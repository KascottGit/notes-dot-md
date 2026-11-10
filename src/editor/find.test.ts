import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { findMatches, matchFrom } from './find';

const state = (doc: string) => EditorState.create({ doc });

describe('find in note', () => {
  it('finds every match, whatever the case', () => {
    const s = state('Milk and milk.\n\nMore MILK');
    expect(findMatches(s, 'milk').map((m) => m.from)).toEqual([0, 9, 21]);
  });

  it('takes the text as typed, not as a pattern', () => {
    const s = state('a.c abc a\\nb');
    expect(findMatches(s, 'a.c')).toEqual([{ from: 0, to: 3 }]);
    expect(findMatches(s, '\\n')).toEqual([{ from: 9, to: 11 }]);
  });

  it('stops counting at the limit, and finds nothing for an empty search', () => {
    const s = state('aaaaaaaaaa');
    expect(findMatches(s, 'a', 4)).toHaveLength(4);
    expect(findMatches(s, '')).toEqual([]);
  });

  it('goes to the first match from a position, and wraps around', () => {
    const s = state('one two one two');
    expect(matchFrom(s, 'one', 1)).toEqual({ from: 8, to: 11 });
    expect(matchFrom(s, 'one', 9)).toEqual({ from: 0, to: 3 });
    expect(matchFrom(s, 'three', 0)).toBeNull();
  });
});
