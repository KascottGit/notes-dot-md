import { describe, expect, it } from 'vitest';
import { diffTokens, lineTokens, mergeText, textEdits, wordTokens } from './merge';

const applyEdits = (text: string, edits: { from: number; to: number; insert: string }[]) => {
  let out = '';
  let pos = 0;
  for (const e of edits) {
    expect(e.from).toBeGreaterThanOrEqual(pos);
    out += text.slice(pos, e.from) + e.insert;
    pos = e.to;
  }
  return out + text.slice(pos);
};

/** A small random generator, so failures can be repeated. */
function random(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
}

describe('tokens', () => {
  it('splits lines from their line breaks', () => {
    expect(lineTokens('a\n\nb\n')).toEqual(['a', '\n', '\n', 'b', '\n']);
    expect(lineTokens('')).toEqual([]);
  });

  it('splits words, spaces and other characters', () => {
    expect(wordTokens('Buy **milk**, 2 eggs')).toEqual([
      'Buy',
      ' ',
      '*',
      '*',
      'milk',
      '*',
      '*',
      ',',
      ' ',
      '2',
      ' ',
      'eggs',
    ]);
    expect(wordTokens('café 日本')).toEqual(['café', ' ', '日本']);
  });
});

describe('diffTokens', () => {
  it('finds the changes between two lists', () => {
    expect(diffTokens(['a', 'b', 'c'], ['a', 'x', 'c'])).toEqual([
      { start: 1, end: 2, insert: ['x'] },
    ]);
    expect(diffTokens(['a', 'b'], ['a', 'b'])).toEqual([]);
    expect(diffTokens([], ['a'])).toEqual([{ start: 0, end: 0, insert: ['a'] }]);
  });

  it('turns one list into the other, for random lists', () => {
    const rand = random(7);
    const list = () =>
      Array.from({ length: Math.floor(rand() * 12) }, () => 'abcd'[Math.floor(rand() * 4)]!);
    for (let i = 0; i < 300; i++) {
      const a = list();
      const b = list();
      const hunks = diffTokens(a, b)!;
      const out: string[] = [];
      let pos = 0;
      for (const h of hunks) {
        out.push(...a.slice(pos, h.start), ...h.insert);
        pos = h.end;
      }
      out.push(...a.slice(pos));
      expect(out).toEqual(b);
    }
  });

  it('gives up on very different lists', () => {
    const a = Array.from({ length: 50 }, (_, i) => `a${i}`);
    const b = Array.from({ length: 50 }, (_, i) => `b${i}`);
    expect(diffTokens(a, b, 20)).toBeNull();
  });
});

describe('mergeText', () => {
  const base = '# Groceries\n\n- [ ] milk\n- [ ] eggs\n- [ ] bread\n\nNotes go here.';

  it('keeps both sides when they changed different lines', () => {
    const mine = base.replace('[ ] milk', '[x] milk');
    const theirs = base.replace('[ ] bread', '[x] bread');
    expect(mergeText(base, mine, theirs)).toBe(
      '# Groceries\n\n- [x] milk\n- [ ] eggs\n- [x] bread\n\nNotes go here.',
    );
  });

  it('keeps edits on lines right next to each other', () => {
    const mine = base.replace('[ ] milk', '[x] milk');
    const theirs = base.replace('[ ] eggs', '[x] eggs');
    expect(mergeText(base, mine, theirs)).toContain('- [x] milk\n- [x] eggs\n');
  });

  it('keeps added and removed lines from both sides', () => {
    const mine = base.replace('- [ ] eggs\n', '');
    const theirs = base + '\nMore notes.';
    expect(mergeText(base, mine, theirs)).toBe(
      '# Groceries\n\n- [ ] milk\n- [ ] bread\n\nNotes go here.\nMore notes.',
    );
  });

  it('adds a line after a last line the other side edited', () => {
    expect(mergeText('a', 'a\nb', 'A')).toBe('A\nb');
  });

  it('merges edits to different words of the same line', () => {
    const line = 'The quick brown fox jumps over the dog';
    expect(
      mergeText(
        line,
        'The quick red fox jumps over the dog',
        'The quick brown fox jumps over the lazy dog',
      ),
    ).toBe('The quick red fox jumps over the lazy dog');
  });

  it('takes the same change made on both sides once', () => {
    const both = base.replace('milk', 'oat milk');
    expect(mergeText(base, both, both)).toBe(both);
    const mine = both.replace('bread', 'rye bread');
    expect(mergeText(base, mine, both)).toBe(mine);
  });

  it('is a conflict when both changed the same word', () => {
    expect(
      mergeText(base, base.replace('milk', 'oat milk'), base.replace('milk', 'soy milk')),
    ).toBeNull();
    expect(mergeText('brown', 'red', 'brawn')).toBeNull();
  });

  it('is a conflict when both changed words right next to each other', () => {
    expect(mergeText('one two', 'one, two', 'one two!')).not.toBeNull(); // a space between
    expect(mergeText('one two', 'ONE two', 'one-two')).toBeNull();
  });

  it('is a conflict when both added text at the same place', () => {
    expect(mergeText(base, base + '\nmine', base + '\ntheirs')).toBeNull();
    expect(mergeText('', 'mine', 'theirs')).toBeNull();
  });

  it('is a conflict when one side deleted a line the other edited', () => {
    expect(mergeText('a\nb\nc', 'a\nc', 'a\nB\nc')).toBeNull();
  });

  it('returns the other side when only one side changed', () => {
    expect(mergeText(base, base, 'theirs')).toBe('theirs');
    expect(mergeText(base, 'mine', base)).toBe('mine');
  });

  it('never loses an edit, for random non-overlapping edits', () => {
    const rand = random(42);
    const words = ['milk', 'eggs', 'bread', 'tea', 'jam'];
    for (let i = 0; i < 200; i++) {
      const lines = Array.from({ length: 12 }, (_, n) => `line ${n} ${words[n % 5]}`);
      const start = lines.join('\n');
      // Mine edits the first half, theirs the second, with a line between.
      const mine = [...lines];
      const theirs = [...lines];
      const m = Math.floor(rand() * 5);
      const t = 7 + Math.floor(rand() * 5);
      mine[m] = `${mine[m]} mine`;
      if (rand() < 0.5) mine.splice(m + 1, 0, 'inserted mine');
      theirs[t] = rand() < 0.5 ? `theirs ${theirs[t]}` : '';
      const merged = mergeText(start, mine.join('\n'), theirs.join('\n'));
      const expected = [...mine];
      expected[mine.indexOf(lines[t]!)] = theirs[t]!;
      expect(merged).toBe(expected.join('\n'));
    }
  });
});

describe('textEdits', () => {
  it('replaces only the changed words', () => {
    const a = 'first line\nThe quick brown fox\nlast line';
    const b = 'first line\nThe quick red fox\nlast line';
    expect(textEdits(a, b)).toEqual([{ from: 21, to: 26, insert: 'red' }]);
  });

  it('turns one text into the other, for random texts', () => {
    const rand = random(3);
    const pieces = ['a', 'b c', '\n', ' ', 'word', '\n\n', 'x!'];
    const text = () =>
      Array.from(
        { length: Math.floor(rand() * 15) },
        () => pieces[Math.floor(rand() * pieces.length)],
      ).join('');
    for (let i = 0; i < 300; i++) {
      const a = text();
      const b = text();
      expect(applyEdits(a, textEdits(a, b))).toBe(b);
    }
  });
});
