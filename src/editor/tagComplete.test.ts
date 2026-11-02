import { CompletionContext } from '@codemirror/autocomplete';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { markdownSupport } from './language';
import { tagSource } from './tagComplete';

const tags = [
  { tag: 'school', saved: true },
  { tag: 'work', saved: false },
];

/** Suggestions with the cursor at `|` in the text. */
function suggest(textWithCursor: string, explicit = false) {
  const pos = textWithCursor.indexOf('|');
  const doc = textWithCursor.replace('|', '');
  const state = EditorState.create({ doc, extensions: [markdownSupport()] });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return tagSource(() => tags)(new CompletionContext(state, pos, explicit));
}

describe('tag suggestions', () => {
  it('suggests tags after # and a letter, from the #', () => {
    const result = suggest('Plan #s|');
    expect(result?.from).toBe(5);
    expect(result?.options.map((o) => o.label)).toEqual(['#school', '#work']);
    expect(result?.options[0]?.boost).toBeGreaterThan(result?.options[1]?.boost ?? 0);
  });

  it('works at the start of a line', () => {
    expect(suggest('#w|')?.from).toBe(0);
  });

  it('waits for a letter after a lone #, unless asked', () => {
    expect(suggest('Plan #|')).toBeNull();
    expect(suggest('Plan #|', true)?.options).toHaveLength(2);
  });

  it('does not suggest inside a word or in code', () => {
    expect(suggest('a#s|')).toBeNull();
    expect(suggest('`code #s|`')).toBeNull();
    expect(suggest('```\n#s|\n```')).toBeNull();
  });

  it('leaves out the tag exactly as typed', () => {
    expect(suggest('#school|')?.options.map((o) => o.label)).toEqual(['#work']);
  });
});
