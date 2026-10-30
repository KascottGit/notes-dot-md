import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { markdownSupport } from './language';
import {
  continueList,
  expandTaskShorthand,
  indentItem,
  indentListItem,
  moveItemDown,
  moveItemUp,
  moveListItem,
  outdentItem,
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

/** Run a command; `|` marks the cursor. */
const up = (text: string) => run(moveItemUp, text).text;
const down = (text: string) => run(moveItemDown, text).text;

describe('moveListItem', () => {
  it('is null off list item lines and at the ends of the note', () => {
    const state = stateOf('- a\ntext');
    expect(moveListItem(state, 0, -1)).toBeNull();
    expect(moveListItem(state, state.doc.line(2).from, -1)).toBeNull();
    expect(moveListItem(stateOf('text\n- a'), 2 + 5, 1)).toBeNull();
  });

  it('is one cut and paste, leaving the rest of the text untouched', () => {
    const state = stateOf('- a\n- b\n- c\n- d');
    const spec = moveListItem(state, 0, 1)!;
    const touched: [number, number][] = [];
    state.update(spec).changes.iterChangedRanges((from, to) => touched.push([from, to]));
    expect(touched).toEqual([
      [0, 4],
      [7, 7],
    ]);
  });
});

describe('moveItemUp / moveItemDown', () => {
  it('swaps items one line at a time', () => {
    expect(down('- a|\n- b\n- c')).toBe('- b\n- a|\n- c');
    expect(up('- a\n- b\n- c|')).toBe('- a\n- c|\n- b');
  });

  it('moves tasks, keeping their state', () => {
    expect(up('- [ ] a\n- [x] b|')).toBe('- [x] b|\n- [ ] a');
  });

  it('takes the indented lines right below the item along', () => {
    expect(down('- a|\n  - a1\n  more a\n- b')).toBe('- b\n- a|\n  - a1\n  more a');
  });

  it('leaves unindented text below the item behind', () => {
    expect(down('- a|\ntext\n- b')).toBe('text\n- a|\n- b');
    expect(up('text\n- a|')).toBe('- a|\ntext');
  });

  it('ends the children at a blank line', () => {
    expect(down('- a|\n  - a1\n\n  - a2')).toBe('\n- a|\n  - a1\n  - a2');
  });

  it('passes blank lines one line at a time', () => {
    expect(down('- a|\n\n- b')).toBe('\n- a|\n- b');
    expect(up('- a\n\n- b|')).toBe('- a\n- b|\n');
  });

  it('jumps above an item when moving up out of its children', () => {
    expect(up('- a\n  - a1\n- b|')).toBe('- b|\n- a\n  - a1');
    expect(up('- a\n  - a1\n    - a11\n- b|')).toBe('- b|\n- a\n  - a1\n    - a11');
    expect(up('- a\n  - a1\n    - a11\n  - a2|')).toBe('- a\n  - a2|\n  - a1\n    - a11');
  });

  it('jumps past an item with children when moving down', () => {
    expect(down('- a|\n- b\n  - b1\n- c')).toBe('- b\n  - b1\n- a|\n- c');
  });

  it('moves a sub-item one line, also past its parent', () => {
    expect(up('- a\n  - a1\n  - a2|')).toBe('- a\n  - a2|\n  - a1');
    expect(up('- a\n  - a1|')).toBe('  - a1|\n- a');
  });

  it('stays put at the start or end of the note', () => {
    expect(run(moveItemUp, '- a|\n- b')).toEqual({ handled: true, text: '- a|\n- b' });
    expect(run(moveItemDown, '- a\n- b|')).toEqual({ handled: true, text: '- a\n- b|' });
  });

  it('renumbers numbered lists, keeping the cursor beside the number', () => {
    expect(down('1. a|\n2. b')).toBe('1. b\n2. a|');
    expect(up('3. a\n4. b\n5. |c')).toBe('3. a\n4. |c\n5. b');
    expect(up('1. a\n|2. b')).toBe('|1. b\n2. a');
    const ten = Array.from({ length: 10 }, (_, i) => `${i + 1}. item${i + 1}`);
    ten[9] = '10. it|em10';
    expect(up(ten.join('\n')).split('\n').slice(8)).toEqual(['9. it|em10', '10. item9']);
  });

  it('moves items inside a quote', () => {
    expect(up('> - a\n> - b|')).toBe('> - b|\n> - a');
  });

  it('moves plain lines outside lists', () => {
    expect(down('one|\ntwo')).toBe('two\none|');
    expect(up('one\ntwo|')).toBe('two|\none');
  });
});

describe('indentItem / outdentItem', () => {
  it('nests and un-nests list items', () => {
    expect(run(indentItem, '- a\n- b|').text).toBe('- a\n  - b|');
    expect(run(outdentItem, '- a\n  - b|').text).toBe('- a\n- b|');
  });

  it('indents and outdents other lines', () => {
    expect(run(indentItem, 'text|').text).toBe('  text|');
    expect(run(outdentItem, '  text|').text).toBe('text|');
  });
});
