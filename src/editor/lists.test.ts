import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { markdownSupport } from './language';
import {
  continueList,
  expandTaskShorthand,
  indentListItem,
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
