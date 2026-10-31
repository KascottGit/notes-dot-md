import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import {
  insertTable,
  newLineAtEnd,
  toggleBold,
  toggleBulletList,
  toggleChecklist,
  toggleCodeBlock,
  toggleHeading,
  toggleInlineCode,
  toggleItalic,
  toggleLink,
  toggleNumberedList,
  toggleQuote,
  toggleStrikethrough,
} from './commands';
import { markdownSupport } from './language';
import { editCell } from './tableEdit';

/**
 * Write documents with `|` for the cursor or `«…»` for a selection, e.g.
 * `a «word» b`. The result uses the same notation.
 */
function stateOf(text: string, readOnly = false) {
  let doc = text;
  let selection: EditorSelection;
  const start = doc.indexOf('«');
  if (start >= 0) {
    doc = doc.replace('«', '');
    const end = doc.indexOf('»');
    doc = doc.replace('»', '');
    selection = EditorSelection.single(start, end);
  } else {
    const at = doc.indexOf('|');
    doc = doc.replace('|', '');
    selection = EditorSelection.single(Math.max(at, 0));
  }
  return EditorState.create({
    doc,
    selection,
    extensions: [markdownSupport(), EditorState.readOnly.of(readOnly)],
  });
}

function show(state: EditorState): string {
  const { from, to, empty } = state.selection.main;
  const doc = state.doc.toString();
  if (empty) return doc.slice(0, from) + '|' + doc.slice(from);
  return doc.slice(0, from) + '«' + doc.slice(from, to) + '»' + doc.slice(to);
}

function apply(cmd: StateCommand, text: string): string {
  let state = stateOf(text);
  cmd({ state, dispatch: (tr) => (state = tr.state) });
  return show(state);
}

/** Apply twice: every command toggles back to where it started. */
function roundTrip(cmd: StateCommand, text: string): string {
  return apply(cmd, apply(cmd, text));
}

describe('wrap commands', () => {
  it('wrap a selection and keep it selected', () => {
    expect(apply(toggleBold, 'a «word» b')).toBe('a **«word»** b');
    expect(apply(toggleItalic, 'a «word» b')).toBe('a *«word»* b');
    expect(apply(toggleStrikethrough, 'a «word» b')).toBe('a ~~«word»~~ b');
    expect(apply(toggleInlineCode, 'a «word» b')).toBe('a `«word»` b');
  });

  it('unwrap when the selection is already formatted', () => {
    expect(apply(toggleBold, 'a **«word»** b')).toBe('a «word» b');
    expect(apply(toggleBold, 'a «**word**» b')).toBe('a «word» b');
    expect(apply(toggleStrikethrough, '~~«x»~~')).toBe('«x»');
    expect(apply(toggleInlineCode, '`«x»`')).toBe('«x»');
  });

  it('round-trip back to the original', () => {
    for (const cmd of [toggleBold, toggleItalic, toggleStrikethrough, toggleInlineCode]) {
      expect(roundTrip(cmd, 'a «word» b')).toBe('a «word» b');
    }
  });

  it('with no selection, insert the markers and put the cursor between them', () => {
    expect(apply(toggleBold, 'a |')).toBe('a **|**');
    expect(apply(toggleInlineCode, '|')).toBe('`|`');
    expect(roundTrip(toggleBold, 'a |')).toBe('a |');
  });

  it('with the cursor inside formatted text, remove the format', () => {
    expect(apply(toggleBold, 'a **wo|rd** b')).toBe('a wo|rd b');
    expect(apply(toggleItalic, '_wo|rd_')).toBe('wo|rd');
  });

  it('italic leaves bold alone, and bold leaves italic alone', () => {
    expect(apply(toggleItalic, '**«bold»**')).toBe('***«bold»***');
    expect(apply(toggleBold, '*«it»*')).toBe('***«it»***');
    expect(apply(toggleItalic, '***«both»***')).toBe('**«both»**');
  });

  it('leave surrounding spaces outside the markers', () => {
    expect(apply(toggleBold, 'a« word »b')).toBe('a **«word»** b');
  });

  it('format each line of a multi-line selection separately', () => {
    expect(apply(toggleBold, '«one\ntwo»')).toBe('**«one**\n**two»**');
    expect(apply(toggleBold, '**«one**\n**two»**')).toBe('«one\ntwo»');
  });

  it('do nothing in a read-only note', () => {
    const state = stateOf('«x»', true);
    expect(toggleBold({ state, dispatch: () => {} })).toBe(false);
  });
});

describe('link', () => {
  it('wraps the selection and puts the cursor in the url', () => {
    expect(apply(toggleLink, 'see «docs» now')).toBe('see [docs](|) now');
  });

  it('inserts an empty link with the cursor in the url', () => {
    expect(apply(toggleLink, 'a |')).toBe('a [](|)');
  });

  it('turns a link back into its text', () => {
    expect(apply(toggleLink, '[do|cs](https://x.y)')).toBe('do|cs');
  });
});

describe('line prefix commands', () => {
  it('headings: add, switch level, remove', () => {
    expect(apply(toggleHeading(1), 'Ti|tle')).toBe('# Ti|tle');
    expect(apply(toggleHeading(2), '# Ti|tle')).toBe('## Ti|tle');
    expect(apply(toggleHeading(2), '## Ti|tle')).toBe('Ti|tle');
  });

  it('apply to every line the selection touches', () => {
    expect(apply(toggleBulletList, '«a\nb\nc»')).toBe('- «a\n- b\n- c»');
    expect(apply(toggleBulletList, '- «a\n- b\n- c»')).toBe('«a\nb\nc»');
  });

  it('add to all when only some lines have it', () => {
    expect(apply(toggleBulletList, '«- a\nb»')).toBe('«- a\n- b»');
  });

  it('skip blank lines in a multi-line selection', () => {
    expect(apply(toggleBulletList, '«a\n\nb»')).toBe('- «a\n\n- b»');
  });

  it('start a list on an empty line, cursor after the marker', () => {
    expect(apply(toggleChecklist, '|')).toBe('- [ ] |');
    expect(apply(toggleBulletList, 'x\n|')).toBe('x\n- |');
  });

  it('numbered lists are numbered in order', () => {
    expect(apply(toggleNumberedList, '«a\nb\nc»')).toBe('1. «a\n2. b\n3. c»');
  });

  it('numbering continues from a numbered item right above', () => {
    expect(apply(toggleNumberedList, '1. a\n2. b\n«c\nd»')).toBe('1. a\n2. b\n3. «c\n4. d»');
  });

  it('switching list type replaces the old marker', () => {
    expect(apply(toggleChecklist, '- «a\n- b»')).toBe('- [ ] «a\n- [ ] b»');
    expect(apply(toggleBulletList, '- [x] «a»')).toBe('- «a»');
    expect(apply(toggleNumberedList, '- «a\n- [ ] b»')).toBe('1. «a\n2. b»');
    expect(apply(toggleBulletList, '1. «a\n2. b»')).toBe('- «a\n- b»');
    expect(apply(toggleHeading(1), '- «a»')).toBe('# «a»');
  });

  it('keep indentation of nested items', () => {
    expect(apply(toggleChecklist, '- a\n  - |b')).toBe('- a\n  - [ ] |b');
    expect(apply(toggleNumberedList, '«a\n   b»')).toBe('1. «a\n   1. b»');
  });

  it('a selection ending at the start of a line does not include that line', () => {
    expect(apply(toggleBulletList, '«a\n»b')).toBe('- «a\n»b');
  });

  it('every list command round-trips', () => {
    for (const cmd of [toggleBulletList, toggleNumberedList, toggleChecklist, toggleHeading(3)]) {
      expect(roundTrip(cmd, '«a\nb»')).toBe('«a\nb»');
    }
  });
});

describe('quote', () => {
  it('adds and removes `> ` on every line', () => {
    expect(apply(toggleQuote, '«a\nb»')).toBe('> «a\n> b»');
    expect(apply(toggleQuote, '> «a\n> b»')).toBe('«a\nb»');
  });

  it('keeps a quote block together across blank lines', () => {
    expect(apply(toggleQuote, '«a\n\nb»')).toBe('> «a\n>\n> b»');
  });

  it('can quote a list', () => {
    expect(apply(toggleQuote, '- |a')).toBe('> - |a');
  });
});

describe('code block', () => {
  it('wraps the selected lines in fences', () => {
    expect(apply(toggleCodeBlock, '«a\nb»')).toBe('```\n«a\nb»\n```');
  });

  it('on an empty line, opens a block with the cursor inside', () => {
    expect(apply(toggleCodeBlock, '|')).toBe('```\n|\n```');
  });

  it('with the cursor at the end of a line, keeps it inside the block', () => {
    expect(apply(toggleCodeBlock, 'code|')).toBe('```\ncode|\n```');
  });

  it('removes the fences when inside a code block', () => {
    expect(apply(toggleCodeBlock, '```\nco|de\n```')).toBe('co|de');
    expect(apply(toggleCodeBlock, 'x\n```ts\na|\nb\n```\ny')).toBe('x\na|\nb\ny');
  });
});

describe('insertTable', () => {
  const T = '|  |  |\n| --- | --- |\n|  |  |';

  it('takes the place of an empty line, with a blank line after it', () => {
    expect(apply(insertTable, '|')).toBe(`${T}|\n\n`);
    expect(apply(insertTable, 'a\n\n|\n\nb')).toBe(`a\n\n${T}|\n\nb`);
  });

  it('goes under a line of text, set apart by blank lines', () => {
    expect(apply(insertTable, 'Some te|xt\nmore')).toBe(`Some text\n\n${T}|\n\nmore`);
  });

  it('asks the table to open its first cell', () => {
    let state = stateOf('|');
    let request: unknown = null;
    insertTable({
      state,
      dispatch: (tr) => {
        request = tr.annotation(editCell) ?? null;
        state = tr.state;
      },
    });
    expect(request).toEqual({ pos: 0, row: 0, col: 0 });
  });

  it('does nothing in a read-only note', () => {
    expect(insertTable({ state: stateOf('|', true), dispatch: () => {} })).toBe(false);
  });
});

describe('newLineAtEnd', () => {
  it('adds a line after text and puts the cursor on it', () => {
    expect(apply(newLineAtEnd, '|Hello')).toBe('Hello\n|');
  });

  it('keeps a blank line after a list, quote or table', () => {
    expect(apply(newLineAtEnd, '|- [ ] a')).toBe('- [ ] a\n\n|');
    expect(apply(newLineAtEnd, '|> quote')).toBe('> quote\n\n|');
    expect(apply(newLineAtEnd, '|| a |\n| - |\n| 1 |')).toBe('| a |\n| - |\n| 1 |\n\n|');
  });

  it('uses an empty last line, adding a blank one after a list', () => {
    expect(apply(newLineAtEnd, '|Hello\n')).toBe('Hello\n|');
    expect(apply(newLineAtEnd, '|- a\n')).toBe('- a\n\n|');
    expect(apply(newLineAtEnd, '|- a\n\n')).toBe('- a\n\n|');
  });
});
