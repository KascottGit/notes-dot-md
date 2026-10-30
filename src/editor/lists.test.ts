import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { markdownSupport } from './language';
import {
  continueList,
  expandTaskShorthand,
  indentListItem,
  listMarkerAt,
  listSiblings,
  moveListItem,
  outdentListItem,
  shorthandInput,
  toggleTaskAt,
} from './lists';

/** `|` marks the cursor. */
function stateOf(text: string) {
  const at = text.indexOf('|');
  const doc = text.replace('|', '');
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(at < 0 ? 0 : at),
    extensions: [markdownSupport()],
  });
}

function run(command: StateCommand, text: string) {
  let state = stateOf(text);
  const handled = command({
    state,
    dispatch: (tr) => {
      state = tr.state;
    },
  });
  const doc = state.doc.toString();
  const head = state.selection.main.head;
  return { handled, text: doc.slice(0, head) + '|' + doc.slice(head) };
}

describe('toggleTaskAt', () => {
  it('checks and unchecks, changing only the box character', () => {
    const state = stateOf('- [ ] a');
    const spec = toggleTaskAt(state, 0)!;
    const next = state.update(spec).state;
    expect(next.doc.toString()).toBe('- [x] a');
    expect(next.update(toggleTaskAt(next, 0)!).state.doc.toString()).toBe('- [ ] a');
  });

  it('works for ordered lists and uppercase X', () => {
    const state = stateOf('1. [X] a');
    expect(state.update(toggleTaskAt(state, 3)!).state.doc.toString()).toBe('1. [ ] a');
  });

  it('does not move the cursor', () => {
    const state = stateOf('- [ ] a\n- [ ] b|');
    const next = state.update(toggleTaskAt(state, 0)!).state;
    expect(next.selection.main.head).toBe(state.selection.main.head);
  });
});

describe('Tab / Shift+Tab in lists', () => {
  it('nests a bullet under the one above', () => {
    expect(run(indentListItem, '- a\n- b|').text).toBe('- a\n  - b|');
  });

  it('nests ordered items to the text column, so they stay children', () => {
    expect(run(indentListItem, '1. a\n2. b|').text).toBe('1. a\n   2. b|');
  });

  it('does nothing to the first item, but keeps the key', () => {
    expect(run(indentListItem, '- a|')).toEqual({ handled: true, text: '- a|' });
  });

  it('does not nest deeper than one level below the item above', () => {
    expect(run(indentListItem, '- a\n  - b|').text).toBe('- a\n  - b|');
  });

  it('outdents back to the parent', () => {
    expect(run(outdentListItem, '- a\n  - b|').text).toBe('- a\n- b|');
    expect(run(outdentListItem, '1. a\n   2. b|').text).toBe('1. a\n2. b|');
  });

  it('leaves Tab alone outside lists', () => {
    expect(run(indentListItem, 'plain|').handled).toBe(false);
    expect(run(outdentListItem, 'plain|').handled).toBe(false);
  });
});

describe('Enter in lists', () => {
  it('continues a task list with an unchecked box', () => {
    expect(run(continueList, '- [x] a|').text).toBe('- [x] a\n- [ ] |');
  });

  it('continues bullets and numbers', () => {
    expect(run(continueList, '- a|').text).toBe('- a\n- |');
    expect(run(continueList, '1. a|').text).toBe('1. a\n2. |');
  });

  it('ends the list on an empty item', () => {
    expect(run(continueList, '- a\n- |').text).toBe('- a\n|');
    expect(run(continueList, '- [ ] a\n- [ ] |').text).toBe('- [ ] a\n|');
  });
});

describe('task shorthand', () => {
  it('expands [] after a list marker', () => {
    expect(expandTaskShorthand('- [', ']')).toBe('- [ ] ');
    expect(expandTaskShorthand('  * [', ']')).toBe('  * [ ] ');
    expect(expandTaskShorthand('1. [', ']')).toBe('1. [ ] ');
  });

  it('normalizes -[] and -[ ] to have a space after the marker', () => {
    expect(expandTaskShorthand('-[', ']')).toBe('- [ ] ');
    expect(expandTaskShorthand('-[ ', ']')).toBe('- [ ]');
    expect(expandTaskShorthand('-[x', ']')).toBe('- [x]');
  });

  it('leaves normal typing alone', () => {
    expect(expandTaskShorthand('- [ ', ']')).toBeNull(); // Typing `- [ ]` by hand.
    expect(expandTaskShorthand('text [', ']')).toBeNull();
    expect(expandTaskShorthand('- [', 'x')).toBeNull();
  });

  it('applies through the input handler with the cursor after the box', () => {
    const state = stateOf('- [|');
    const spec = shorthandInput(state, 3, 3, ']')!;
    const next = state.update(spec).state;
    expect(next.doc.toString()).toBe('- [ ] ');
    expect(next.selection.main.head).toBe(6);
  });

  it('does not apply inside code', () => {
    const state = stateOf('```\n- [|\n```');
    expect(shorthandInput(state, 7, 7, ']')).toBeNull();
  });
});

/** Move the item on 1-based line `line` to `slot`; `|` marks the cursor. */
function move(text: string, line: number, slot: number) {
  const state = stateOf(text);
  const result = moveListItem(state, state.doc.line(line).from, slot);
  if (!result) return null;
  const next = state.update(result.spec).state;
  const doc = next.doc.toString();
  const head = next.selection.main.head;
  return doc.slice(0, head) + '|' + doc.slice(head);
}

describe('listMarkerAt', () => {
  it('covers the bullet, the number, or the bullet through the task box', () => {
    const state = stateOf('- a\n  - [ ] b\n\n3. c');
    expect(listMarkerAt(state, 0)).toEqual({ item: 0, from: 0, to: 1 });
    const task = state.doc.line(2);
    expect(listMarkerAt(state, task.from)).toEqual({
      item: task.from + 2,
      from: task.from + 2,
      to: task.from + 7,
    });
    const num = state.doc.line(4);
    expect(listMarkerAt(state, num.from)).toEqual({
      item: num.from,
      from: num.from,
      to: num.from + 2,
    });
  });

  it('is null outside lists', () => {
    expect(listMarkerAt(stateOf('just text'), 0)).toBeNull();
    expect(listMarkerAt(stateOf('- a\n  more of a'), 4)).toBeNull();
  });
});

describe('listSiblings', () => {
  it('groups each item with its sub-items', () => {
    const state = stateOf('- a\n  - a1\n  - a2\n- b\n- c');
    expect(listSiblings(state, state.doc.line(4).from)).toEqual({
      blocks: [
        { from: 1, to: 3 },
        { from: 4, to: 4 },
        { from: 5, to: 5 },
      ],
      index: 1,
    });
  });

  it('gives a sub-item only its own siblings', () => {
    const state = stateOf('- a\n  - a1\n  - a2\n- b');
    expect(listSiblings(state, state.doc.line(3).from)).toEqual({
      blocks: [
        { from: 2, to: 2 },
        { from: 3, to: 3 },
      ],
      index: 1,
    });
  });

  it('is null off a list item line', () => {
    expect(listSiblings(stateOf('text\n- a'), 0)).toBeNull();
  });
});

describe('moveListItem', () => {
  it('moves an item down and up', () => {
    expect(move('- a\n- b|\n- c', 1, 3)).toBe('- b|\n- c\n- a');
    expect(move('- a\n- b|\n- c', 3, 0)).toBe('- c\n- a\n- b|');
  });

  it('moves tasks, keeping their state', () => {
    expect(move('- [ ] a\n- [x] b|', 2, 0)).toBe('- [x] b|\n- [ ] a');
  });

  it('moves sub-items along with their item', () => {
    expect(move('- a\n  - a1\n- b|', 1, 2)).toBe('- b|\n- a\n  - a1');
  });

  it('keeps blank lines between items in place', () => {
    expect(move('- a\n\n- b|\n\n- c', 5, 0)).toBe('- c\n\n- a\n\n- b|');
  });

  it('renumbers numbered lists from their first number', () => {
    expect(move('3. a\n4. b\n5. |c', 3, 0)).toBe('3. |c\n4. a\n5. b');
    expect(move('1) a\n2) b|', 1, 2)).toBe('1) b|\n2) a');
  });

  it('keeps the cursor in the moved item, across a renumbered marker', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `${i + 1}. item${i + 1}`);
    lines[9] = '10. it|em10';
    expect(move(lines.join('\n'), 10, 0)!.split('\n')[0]).toBe('1. it|em10');
  });

  it('moves items inside a quote', () => {
    expect(move('> - a\n> - b|', 2, 0)).toBe('> - b|\n> - a');
  });

  it('leaves text outside the list alone', () => {
    expect(move('# T\n\n- a\n- b\n\nend|', 4, 0)).toBe('# T\n\n- b\n- a\n\nend|');
  });

  it('reports where the moved item and its lines end up', () => {
    const state = stateOf('- a\n- b\n  - b1\n- c');
    const result = moveListItem(state, state.doc.line(2).from, 0)!;
    const doc = state.update(result.spec).state.doc;
    expect(doc.toString()).toBe('- b\n  - b1\n- a\n- c');
    expect(result.item).toBe(0);
    expect(result.lines).toEqual({ from: 0, to: doc.line(2).from });
  });

  it('is one cut and paste, leaving the rest of the text untouched', () => {
    const state = stateOf('- a\n- b\n- c\n- d');
    const result = moveListItem(state, state.doc.line(1).from, 2)!;
    const touched: [number, number][] = [];
    state.update(result.spec).changes.iterChangedRanges((from, to) => touched.push([from, to]));
    expect(touched).toEqual([
      [0, 4],
      [7, 7],
    ]);
  });

  it('does nothing when the item stays where it is', () => {
    expect(move('- a\n- b', 1, 0)).toBeNull();
    expect(move('- a\n- b', 1, 1)).toBeNull();
    expect(move('- a\n- b', 1, 5)).toBeNull();
    expect(move('text', 1, 0)).toBeNull();
  });
});
