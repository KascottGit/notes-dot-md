import { EditorState, type ChangeSpec } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { markdownSupport } from './language';
import {
  cellText,
  columnAlign,
  deleteColumn,
  deleteRow,
  escapeCell,
  insertColumn,
  insertRow,
  setCell,
  setColumnAlign,
  splitRow,
  tableLayoutAt,
} from './tableEdit';

const TABLE = 'Intro\n\n| A | B |\n|:--|--:|\n| 1 | 2 |\n| 3 |\n\nEnd';

function layout(doc = TABLE) {
  const state = EditorState.create({ doc, extensions: [markdownSupport()] });
  return { state, layout: tableLayoutAt(state, doc.indexOf('|'))! };
}

function apply(doc: string, change: ChangeSpec | ChangeSpec[] | null) {
  const state = EditorState.create({ doc });
  return state.update({ changes: change ?? [] }).state.doc.toString();
}

describe('splitRow', () => {
  const cells = (text: string) => splitRow(text).map((c) => c.text);

  it('splits at pipes, with or without outer pipes', () => {
    expect(cells('| a | b |')).toEqual(['a', 'b']);
    expect(cells('a | b')).toEqual(['a', 'b']);
    expect(cells('| a | b')).toEqual(['a', 'b']);
    expect(cells('|  | b |')).toEqual(['', 'b']);
  });

  it('keeps escaped pipes inside a cell', () => {
    expect(cells('| a \\| b | c |')).toEqual(['a \\| b', 'c']);
  });

  it('gives each cell its place in the line', () => {
    expect(splitRow('| ab | c |', 10)[0]).toEqual({ from: 11, to: 15, text: 'ab' });
  });
});

describe('tableLayoutAt', () => {
  it('finds the header, delimiter and body rows', () => {
    const { layout: t } = layout();
    expect(t.columns).toBe(2);
    expect(t.body).toHaveLength(2);
    expect(TABLE.slice(t.from, t.to)).toBe('| A | B |\n|:--|--:|\n| 1 | 2 |\n| 3 |');
    expect(cellText(t, 0, 1)).toBe('B');
    expect(cellText(t, 2, 1)).toBe('');
  });

  it('is null outside tables', () => {
    const state = EditorState.create({ doc: 'text', extensions: [markdownSupport()] });
    expect(tableLayoutAt(state, 0)).toBeNull();
  });
});

describe('table edits', () => {
  it('sets one cell, escaping pipes and line breaks', () => {
    const { layout: t } = layout();
    expect(apply(TABLE, setCell(t, 1, 0, 'x|y\nz'))).toContain('| x\\|y z | 2 |');
    expect(apply(TABLE, setCell(t, 1, 1, ''))).toContain('| 1 |  |');
  });

  it('fills out a short row to reach a missing cell', () => {
    const { layout: t } = layout();
    expect(apply(TABLE, setCell(t, 2, 1, 'four'))).toContain('\n| 3 | four |\n');
  });

  it('adds an empty row after a row', () => {
    const { layout: t } = layout();
    expect(apply(TABLE, insertRow(t, 0))).toContain('|:--|--:|\n|  |  |\n| 1 | 2 |');
    expect(apply(TABLE, insertRow(t, 2))).toContain('| 3 |\n|  |  |\n\nEnd');
  });

  it('adds a column, keeping the alignment row', () => {
    const { layout: t } = layout();
    expect(apply(TABLE, insertColumn(t, 0))).toBe(
      'Intro\n\n| A |  | B |\n| :-- | --- | --: |\n| 1 |  | 2 |\n| 3 |  |  |\n\nEnd',
    );
  });

  it('deletes a body row, never the header', () => {
    const { layout: t } = layout();
    expect(apply(TABLE, deleteRow(t, 1))).toBe('Intro\n\n| A | B |\n|:--|--:|\n| 3 |\n\nEnd');
    expect(deleteRow(t, 0)).toBeNull();
  });

  it('deletes a column, but not the last one', () => {
    const { layout: t } = layout();
    expect(apply(TABLE, deleteColumn(t, 0))).toBe('Intro\n\n| B |\n| --: |\n| 2 |\n|  |\n\nEnd');
    const single = layout('| A |\n| - |\n| 1 |').layout;
    expect(deleteColumn(single, 0)).toBeNull();
  });

  it('escapes pipes that are not escaped yet', () => {
    expect(escapeCell('a|b \\| c')).toBe('a\\|b \\| c');
  });
});

describe('column alignment', () => {
  it('reads it from the delimiter row', () => {
    const { layout: t } = layout();
    expect(columnAlign(t, 0)).toBe('left');
    expect(columnAlign(t, 1)).toBe('right');
    const plain = layout('| A | B |\n| :-: | --- |\n| 1 | 2 |').layout;
    expect([columnAlign(plain, 0), columnAlign(plain, 1)]).toEqual(['center', null]);
  });

  it('sets it, changing only the delimiter row', () => {
    const { layout: t } = layout();
    expect(apply(TABLE, setColumnAlign(t, 0, 'center'))).toBe(
      'Intro\n\n| A | B |\n| :---: | --: |\n| 1 | 2 |\n| 3 |\n\nEnd',
    );
    expect(apply(TABLE, setColumnAlign(t, 1, null))).toContain('| :-- | --- |');
  });
});
