import { describe, expect, it } from 'vitest';
import {
  addCard,
  addColumn,
  archiveCard,
  boardTags,
  cardKeys,
  type KeyedCard,
  deleteArchivedCard,
  deleteColumn,
  joinAttachments,
  setAttachments,
  splitAttachments,
  documentTags,
  hasTag,
  bodyForFile,
  countTasks,
  doneColumnIndex,
  dueStatus,
  localDate,
  headingFixes,
  isBoard,
  moveCard,
  moveColumn,
  NEW_BOARD_TEXT,
  openFence,
  parseBoard,
  parseMeta,
  renameCard,
  renameColumn,
  restoreCard,
  replaceBody,
  setDueDate,
  visibleColumns,
} from './board';

const SAMPLE = `<!-- notes.md:board -->

# Todo

## Write internship report
#school 📅 2026-11-03

Description of the task.

- [ ] Outline
- [x] First draft

More details.

## Email supervisor
#school

# Ongoing

# Done
`;

const slice = (text: string, span: { from: number; to: number }) => text.slice(span.from, span.to);

function structure(text: string) {
  return parseBoard(text).columns.map((c) => [c.title, c.cards.map((card) => card.title)]);
}

describe('isBoard', () => {
  it('needs the marker on the first line', () => {
    expect(isBoard(SAMPLE)).toBe(true);
    expect(isBoard('<!-- notes.md:board -->')).toBe(true);
    expect(isBoard('﻿<!-- notes.md:board -->  \n# A')).toBe(true);
    expect(isBoard('# Notes\n<!-- notes.md:board -->')).toBe(false);
    expect(isBoard('')).toBe(false);
  });
});

describe('parseBoard', () => {
  it('reads columns, cards and bodies', () => {
    const board = parseBoard(SAMPLE);
    expect(structure(SAMPLE)).toEqual([
      ['Todo', ['Write internship report', 'Email supervisor']],
      ['Ongoing', []],
      ['Done', []],
    ]);
    const [report, email] = board.columns[0]!.cards;
    expect(slice(SAMPLE, report!.body)).toBe(
      '#school 📅 2026-11-03\n\nDescription of the task.\n\n- [ ] Outline\n- [x] First draft\n\nMore details.',
    );
    expect(report!.meta).toEqual({ tags: ['school'], due: '2026-11-03' });
    expect(report!.tasks).toEqual({ done: 1, total: 2 });
    expect(slice(SAMPLE, email!.body)).toBe('#school');
    expect(slice(SAMPLE, email!.block)).toBe('## Email supervisor\n#school\n\n');
  });

  it('ignores headings inside fenced code', () => {
    const text =
      '<!-- notes.md:board -->\n# A\n## Card\n```sh\n# a comment\n## another\n```\n# B\n';
    expect(structure(text)).toEqual([
      ['A', ['Card']],
      ['B', []],
    ]);
  });

  it('lets an unclosed fence run to the end, like CommonMark', () => {
    const text = '<!-- notes.md:board -->\n# A\n## One\n```\ncode\n## Two\n';
    expect(structure(text)).toEqual([['A', ['One']]]);
  });

  it('needs a space after the hashes, so #tags are not headings', () => {
    const text = '<!-- notes.md:board -->\n# A\n## Card\n#tag\n##x\n### Sub\n';
    expect(structure(text)).toEqual([['A', ['Card']]]);
  });

  it('keeps text before the first column and before the first card', () => {
    const text = '<!-- notes.md:board -->\nAbout this board.\n\n# A\nColumn notes\n\n## Card\n';
    const board = parseBoard(text);
    expect(slice(text, board.intro)).toBe('About this board.');
    expect(slice(text, board.columns[0]!.intro)).toBe('Column notes');
  });

  it('handles empty cards and a heading on the last line', () => {
    const text = '<!-- notes.md:board -->\n# A\n## Last';
    const card = parseBoard(text).columns[0]!.cards[0]!;
    expect(card.body).toEqual({ from: text.length, to: text.length });
  });

  it('hides Archive and treats the last shown column as done', () => {
    const text = '<!-- notes.md:board -->\n# Todo\n# Done\n# Archive\n## Old\n';
    const board = parseBoard(text);
    expect(visibleColumns(board).map((v) => v.column.title)).toEqual(['Todo', 'Done']);
    expect(doneColumnIndex(board)).toBe(1);
  });

  it('strips a closing hash sequence from titles', () => {
    expect(structure('<!-- notes.md:board -->\n# Todo ##\n## Card #\n')).toEqual([
      ['Todo', ['Card']],
    ]);
  });
});

describe('metadata', () => {
  it('is the first non-empty line, only tags and a due date', () => {
    expect(parseMeta('\n#a #b-c 📅 2026-01-02\ntext')).toEqual({
      tags: ['a', 'b-c'],
      due: '2026-01-02',
    });
    expect(parseMeta('#a and more')).toEqual({ tags: [], due: null });
    expect(parseMeta('text\n#a')).toEqual({ tags: [], due: null });
    expect(parseMeta('📅 2026-1-2')).toEqual({ tags: [], due: null });
  });

  it('sets, changes and removes the due date', () => {
    expect(setDueDate('', '2026-11-03')).toBe('📅 2026-11-03');
    expect(setDueDate('Some text', '2026-11-03')).toBe('📅 2026-11-03\n\nSome text');
    expect(setDueDate('#school\n\nText', '2026-11-03')).toBe('#school 📅 2026-11-03\n\nText');
    expect(setDueDate('#school 📅 2026-11-03\n\nText', '2026-12-24')).toBe(
      '#school 📅 2026-12-24\n\nText',
    );
    expect(setDueDate('#school 📅 2026-11-03', null)).toBe('#school');
    expect(setDueDate('📅 2026-11-03\n\nText', null)).toBe('Text');
    expect(setDueDate('Text', null)).toBe('Text');
  });
});

describe('countTasks', () => {
  it('counts nested tasks but not code', () => {
    expect(countTasks('- [ ] a\n    - [x] b\n1. [X] c\n```\n- [ ] no\n```')).toEqual({
      done: 2,
      total: 3,
    });
  });
});

describe('headingFixes', () => {
  const apply = (body: string, mode: 'typed' | 'pasted') => {
    let out = body;
    for (const fix of headingFixes(body, mode).reverse()) {
      out = out.slice(0, fix.from) + fix.insert + out.slice(fix.from);
    }
    return out;
  };

  it('turns typed # and ## lines into ###', () => {
    expect(apply('# ', 'typed')).toBe('### ');
    expect(apply('text\n## Title\n  # x', 'typed')).toBe('text\n### Title\n  ### x');
  });

  it('moves pasted headings down two levels', () => {
    expect(apply('# A\n## B\n### C', 'pasted')).toBe('### A\n#### B\n### C');
  });

  it('leaves tags, deeper headings and code alone', () => {
    expect(headingFixes('#tag\n### ok\n```\n# comment\n```\n    # indented', 'typed')).toEqual([]);
    expect(headingFixes('```\n# open fence', 'typed')).toEqual([]);
  });
});

describe('bodies', () => {
  it('saves without trailing blank lines and closes open code blocks', () => {
    expect(bodyForFile('text\n\n  \n')).toBe('text');
    expect(bodyForFile('a\n````js\ncode')).toBe('a\n````js\ncode\n````');
    expect(bodyForFile('~~~\nx\n~~~')).toBe('~~~\nx\n~~~');
    expect(openFence('```\na\n```\n```')).toBe('```');
  });

  it('replaces a body and keeps the blank line before the next card', () => {
    const card = parseBoard(SAMPLE).columns[0]!.cards[1]!;
    const next = replaceBody(SAMPLE, card.body, '#school\n\nCall on Monday.\n\n');
    expect(next).toBe(
      SAMPLE.replace('#school\n\n# Ongoing', '#school\n\nCall on Monday.\n\n# Ongoing'),
    );
  });

  it('fills an empty body', () => {
    const text = '<!-- notes.md:board -->\n# A\n## One\n## Two\n';
    const one = parseBoard(text).columns[0]!.cards[0]!;
    expect(replaceBody(text, one.body, 'Body')).toBe(
      '<!-- notes.md:board -->\n# A\n## One\nBody\n\n## Two\n',
    );
    const last = '<!-- notes.md:board -->\n# A\n## One';
    const card = parseBoard(last).columns[0]!.cards[0]!;
    expect(replaceBody(last, card.body, 'Body')).toBe(`${last}\nBody`);
  });

  it('empties a body', () => {
    const card = parseBoard(SAMPLE).columns[0]!.cards[1]!;
    expect(replaceBody(SAMPLE, card.body, '')).toBe(
      SAMPLE.replace('## Email supervisor\n#school\n', '## Email supervisor\n'),
    );
  });

  it('keeps the board in one piece when a code block is left open', () => {
    const card = parseBoard(SAMPLE).columns[0]!.cards[1]!;
    const next = replaceBody(SAMPLE, card.body, '```\nunfinished');
    expect(structure(next)).toEqual(structure(SAMPLE));
  });
});

describe('moving', () => {
  it('moves a card to another column, exact lines only', () => {
    const next = moveCard(SAMPLE, { column: 0, card: 1 }, { column: 1, card: 0 });
    expect(structure(next)).toEqual([
      ['Todo', ['Write internship report']],
      ['Ongoing', ['Email supervisor']],
      ['Done', []],
    ]);
    expect(next).toBe(
      SAMPLE.replace('## Email supervisor\n#school\n\n', '').replace(
        '# Ongoing\n',
        '# Ongoing\n\n## Email supervisor\n#school\n',
      ),
    );
  });

  it('reorders cards within a column', () => {
    const next = moveCard(SAMPLE, { column: 0, card: 1 }, { column: 0, card: 0 });
    expect(structure(next)[0]).toEqual(['Todo', ['Email supervisor', 'Write internship report']]);
    expect(moveCard(next, { column: 0, card: 0 }, { column: 0, card: 1 })).toBe(SAMPLE);
  });

  it('moves the last card of the file, which has no line break', () => {
    const text = '<!-- notes.md:board -->\n# A\n## One\n\n# B\n## Two';
    const next = moveCard(text, { column: 1, card: 0 }, { column: 0, card: 0 });
    expect(next).toBe('<!-- notes.md:board -->\n# A\n\n## Two\n\n## One\n\n# B\n');
  });

  it('ends the file with one line break when moving to the end', () => {
    const next = moveCard(SAMPLE, { column: 0, card: 0 }, { column: 2, card: 0 });
    expect(structure(next)[2]).toEqual(['Done', ['Write internship report']]);
    expect(
      next.endsWith(
        '# Done\n\n## Write internship report\n#school 📅 2026-11-03\n\nDescription of the task.\n\n- [ ] Outline\n- [x] First draft\n\nMore details.\n',
      ),
    ).toBe(true);
  });

  it('moves columns', () => {
    const next = moveColumn(SAMPLE, 2, 0);
    expect(structure(next).map(([t]) => t)).toEqual(['Done', 'Todo', 'Ongoing']);
    expect(moveColumn(next, 0, 2)).toBe(SAMPLE);
  });
});

describe('card edits', () => {
  it('adds a card at the end of a column', () => {
    const { text, card } = addCard(SAMPLE, 1);
    expect(card).toEqual({ column: 1, card: 0 });
    expect(text).toContain('# Ongoing\n\n## Untitled\n\n# Done');
    expect(addCard(NEW_BOARD_TEXT, 2).text).toBe(`${NEW_BOARD_TEXT}\n## Untitled\n`);
  });

  it('renames a card on one line', () => {
    const next = renameCard(SAMPLE, { column: 0, card: 1 }, 'Email\nthe supervisor ');
    expect(next).toBe(SAMPLE.replace('## Email supervisor', '## Email the supervisor'));
    expect(renameCard(SAMPLE, { column: 0, card: 1 }, '  ')).toBe(SAMPLE);
  });

  it('archives a card, adding the Archive column when needed', () => {
    const once = archiveCard(SAMPLE, { column: 0, card: 1 });
    expect(structure(once)).toEqual([
      ['Todo', ['Write internship report']],
      ['Ongoing', []],
      ['Done', []],
      ['Archive', ['Email supervisor']],
    ]);
    const twice = archiveCard(once, { column: 0, card: 0 });
    expect(structure(twice)[3]).toEqual([
      'Archive',
      ['Email supervisor', 'Write internship report'],
    ]);
  });
});

const M = '<!-- notes.md:board -->';

describe('tags on cards', () => {
  const text = `${M}\n# Todo\n## Plan #trip\n#home\nPack for #Trip and #beach\n\n\`\`\`\n#not-a-tag\n\`\`\`\n## Other\nNo tags\n# Done\n## Old #home\n# Archive\n## Gone #home\n`;
  const board = parseBoard(text);

  it('collects tags from the title and body, once each, not in code', () => {
    expect(board.columns[0]!.cards[0]!.tags).toEqual(['trip', 'home', 'beach']);
    expect(board.columns[0]!.cards[1]!.tags).toEqual([]);
  });

  it('matches a tag in any case', () => {
    expect(hasTag(board.columns[0]!.cards[0]!, 'TRIP')).toBe(true);
    expect(hasTag(board.columns[0]!.cards[1]!, 'trip')).toBe(false);
  });

  it('lists the board tags by use, leaving out Archive', () => {
    expect(boardTags(board)).toEqual([
      { tag: 'home', count: 2 },
      { tag: 'beach', count: 1 },
      { tag: 'trip', count: 1 },
    ]);
  });
});

describe('columns', () => {
  it('adds a column after the shown ones, before Archive', () => {
    const plain = addColumn(`${M}\n\n# Todo\n\n# Done\n`, 'Later');
    expect(plain.text).toBe(`${M}\n\n# Todo\n\n# Done\n\n# Later\n`);
    expect(plain.column).toBe(2);
    const withArchive = addColumn(`${M}\n\n# Todo\n\n# Archive\n\n## Old\n`);
    expect(withArchive.text).toBe(`${M}\n\n# Todo\n\n# Untitled\n\n# Archive\n\n## Old\n`);
    expect(withArchive.column).toBe(1);
  });

  it('renames a column, but never to Archive or nothing', () => {
    const text = `${M}\n# Todo\n## A\n`;
    expect(renameColumn(text, 0, '  Next   up ')).toBe(`${M}\n# Next up\n## A\n`);
    expect(renameColumn(text, 0, 'archive')).toBe(text);
    expect(renameColumn(text, 0, '  ')).toBe(text);
  });

  it('deletes an empty column', () => {
    expect(deleteColumn(`${M}\n\n# Todo\n\n# Doing\n\n# Done\n`, 1)).toBe(
      `${M}\n\n# Todo\n\n# Done\n`,
    );
  });

  it('moves a deleted column’s cards to Archive, in order', () => {
    const text = `${M}\n\n# Todo\n\n## A\n\nbody\n\n## B\n\n# Done\n`;
    const next = deleteColumn(text, 0);
    const board = parseBoard(next);
    expect(board.columns.map((c) => c.title)).toEqual(['Done', 'Archive']);
    expect(board.columns[1]!.cards.map((c) => c.title)).toEqual(['A', 'B']);
    expect(next).toContain('## A\n\nbody\n');
  });

  it('keeps text under a deleted column’s heading as an archived card', () => {
    const next = deleteColumn(`${M}\n\n# Ideas\n\nSome notes\n\n# Done\n`, 0);
    const board = parseBoard(next);
    expect(board.columns.map((c) => c.title)).toEqual(['Done', 'Archive']);
    const card = board.columns[1]!.cards[0]!;
    expect(card.title).toBe('Ideas');
    expect(next.slice(card.body.from, card.body.to)).toBe('Some notes');
  });
});

describe('documentTags', () => {
  it('lists each tag once, most used first, not in code', () => {
    const text = [
      'Plan for #school and #Work',
      '`#notatag` and ```',
      '```',
      '#ignored in code',
      '```',
      'More #work and #school, #work again. Not a#tag or #123.',
    ].join('\n');
    expect(documentTags(text)).toEqual(['Work', 'school']);
  });

  it('finds tags on board cards', () => {
    expect(
      documentTags('<!-- notes.md:board -->\n\n# Todo\n\n## Report #uni\n\n#uni #urgent\n'),
    ).toEqual(['uni', 'urgent']);
  });
});

describe('card attachments', () => {
  const img = (id: string) => `![](https://drive.google.com/file/d/${id}/view)`;

  it('splits the image lines at the end of a body from its text', () => {
    expect(splitAttachments(`Some text\n\n${img('a1')}\n${img('b-2')}`)).toEqual({
      text: 'Some text',
      attachments: [
        { id: 'a1', alt: '' },
        { id: 'b-2', alt: '' },
      ],
    });
    expect(splitAttachments(img('a1'))).toEqual({ text: '', attachments: [{ id: 'a1', alt: '' }] });
  });

  it('leaves image lines before other text, other images and code alone', () => {
    const body = `${img('a1')}\n\nText after`;
    expect(splitAttachments(body)).toEqual({ text: body, attachments: [] });
    const web = 'Text\n\n![](https://example.com/x.png)';
    expect(splitAttachments(web).attachments).toEqual([]);
    const code = `\`\`\`\n${img('a1')}\n\`\`\``;
    expect(splitAttachments(code).attachments).toEqual([]);
  });

  it('joins text and attachments with a blank line', () => {
    const a = [{ id: 'a1', alt: '' }];
    expect(joinAttachments('Text\n', a)).toBe(`Text\n\n${img('a1')}`);
    expect(joinAttachments('', a)).toBe(img('a1'));
    expect(joinAttachments('Text', [])).toBe('Text');
  });

  it("sets a card's attachments, changing only its body", () => {
    const board = '<!-- notes.md:board -->\n\n# Todo\n\n## A\n\nText\n\n## B\n\nOther\n';
    const once = setAttachments(board, { column: 0, card: 0 }, [{ id: 'x', alt: '' }]);
    expect(once).toBe(
      `<!-- notes.md:board -->\n\n# Todo\n\n## A\n\nText\n\n${img('x')}\n\n## B\n\nOther\n`,
    );
    const card = parseBoard(once).columns[0]!.cards[0]!;
    expect(card.attachments).toEqual([{ id: 'x', alt: '' }]);
    const twice = setAttachments(once, { column: 0, card: 0 }, [
      { id: 'y', alt: '' },
      { id: 'x', alt: '' },
    ]);
    expect(twice).toContain(`Text\n\n${img('y')}\n${img('x')}\n\n## B`);
    expect(setAttachments(twice, { column: 0, card: 0 }, [])).toBe(board);
  });
});

describe('due dates', () => {
  it('compares with today', () => {
    expect(dueStatus('2026-11-02', '2026-11-03')).toBe('overdue');
    expect(dueStatus('2026-11-03', '2026-11-03')).toBe('today');
    expect(dueStatus('2026-12-01', '2026-11-03')).toBe('later');
  });

  it("writes today's date in local time", () => {
    expect(localDate(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});

describe('restoreCard', () => {
  const board =
    '<!-- notes.md:board -->\n\n# Todo\n\n## A\n\n# Done\n\n# Archive\n\n## Old\n\nBody\n\n## Older\n';

  it('moves an archived card to the end of the first column', () => {
    const next = restoreCard(board, 0);
    const parsed = parseBoard(next);
    expect(parsed.columns[0]!.cards.map((c) => c.title)).toEqual(['A', 'Old']);
    expect(parsed.columns[2]!.cards.map((c) => c.title)).toEqual(['Older']);
    expect(next).toContain('## Old\n\nBody\n');
  });

  it('leaves the text alone without an archive or a column to go to', () => {
    expect(restoreCard('<!-- notes.md:board -->\n\n# Todo\n', 0)).toBe(
      '<!-- notes.md:board -->\n\n# Todo\n',
    );
    const onlyArchive = '<!-- notes.md:board -->\n\n# Archive\n\n## Old\n';
    expect(restoreCard(onlyArchive, 0)).toBe(onlyArchive);
  });
});

describe('deleteArchivedCard', () => {
  it("removes an archived card's lines and nothing else", () => {
    const board =
      '<!-- notes.md:board -->\n\n# Todo\n\n## A\n\n# Archive\n\n## Old\n\nBody\n\n## Older\n';
    expect(deleteArchivedCard(board, 0)).toBe(
      '<!-- notes.md:board -->\n\n# Todo\n\n## A\n\n# Archive\n\n## Older\n',
    );
    expect(deleteArchivedCard(board, 5)).toBe(board);
  });
});

describe('cardKeys', () => {
  const keysOf = (text: string, prev: KeyedCard[][], seq: { n: number }) =>
    cardKeys(parseBoard(text), prev, () => `k${seq.n++}`);
  const flat = (keys: KeyedCard[][]) => keys.map((c) => c.map((k) => k.key));
  const start = '# Todo\n\n## A\n\n## B\n\n## C\n\n# Done\n\n## D\n';

  it('gives every card its own key', () => {
    expect(flat(keysOf(start, [], { n: 0 }))).toEqual([['k0', 'k1', 'k2'], ['k3']]);
  });

  it('keeps each card’s key when one is taken out above the others', () => {
    const seq = { n: 0 };
    const before = keysOf(start, [], seq);
    const after = keysOf(archiveCard(start, { column: 0, card: 0 }), before, seq);
    // A went to the Archive column; B and C kept their keys.
    expect(flat(after)).toEqual([['k1', 'k2'], ['k3'], ['k0']]);
  });

  it('keeps the key when a card moves or is renamed', () => {
    const seq = { n: 0 };
    const before = keysOf(start, [], seq);
    const moved = moveCard(start, { column: 0, card: 2 }, { column: 0, card: 0 });
    expect(flat(keysOf(moved, before, seq))).toEqual([['k2', 'k0', 'k1'], ['k3']]);
    const renamed = renameCard(start, { column: 0, card: 1 }, 'B2');
    expect(flat(keysOf(renamed, before, seq))).toEqual([['k0', 'k1', 'k2'], ['k3']]);
  });

  it('tells cards with the same title apart, and gives a new card a new key', () => {
    const seq = { n: 0 };
    const text = '# Todo\n\n## Untitled\n\n## Untitled\n';
    const before = keysOf(text, [], seq);
    const added = addCard(text, 0).text;
    expect(flat(keysOf(added, before, seq))).toEqual([['k0', 'k1', 'k2']]);
  });
});
