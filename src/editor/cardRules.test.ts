import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { noBoardHeadings } from './cardRules';

function type(doc: string, at: number, insert: string, userEvent = 'input.type') {
  const state = EditorState.create({
    doc,
    selection: { anchor: at },
    extensions: [noBoardHeadings],
  });
  const tr = state.update({
    changes: { from: at, insert },
    selection: { anchor: at + insert.length },
    userEvent,
  });
  return { text: tr.state.doc.toString(), cursor: tr.state.selection.main.head };
}

describe('noBoardHeadings', () => {
  it('turns a typed "# " into "### " and keeps the cursor after it', () => {
    expect(type('#', 1, ' ')).toEqual({ text: '### ', cursor: 4 });
    expect(type('Text\n##', 7, ' ')).toEqual({ text: 'Text\n### ', cursor: 9 });
  });

  it('leaves #tags and deeper headings alone', () => {
    expect(type('', 0, '#school').text).toBe('#school');
    expect(type('###', 3, ' ').text).toBe('### ');
  });

  it('moves pasted headings down two levels', () => {
    expect(type('', 0, '# A\n## B\ntext', 'input.paste').text).toBe('### A\n#### B\ntext');
  });

  it('leaves code alone', () => {
    expect(type('```\n', 4, '# comment').text).toBe('```\n# comment');
  });
});
