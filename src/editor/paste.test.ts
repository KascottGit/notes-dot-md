import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { addSpot, imageLineChange, imageSpots } from './paste';

const line = '![](https://drive.google.com/file/d/x/view)';

describe('image lines', () => {
  const apply = (doc: string, pos: number) => {
    const state = EditorState.create({ doc });
    return state.update({ changes: imageLineChange(state, pos, line) }).state.doc.toString();
  };

  it('go on a line of their own', () => {
    expect(apply('Before after', 7)).toBe(`Before \n${line}\nafter`);
    expect(apply('Text', 4)).toBe(`Text\n${line}`);
    expect(apply('', 0)).toBe(line);
    expect(apply('A\n\nB', 2)).toBe(`A\n${line}\nB`);
  });
});

describe('image spots', () => {
  it('move along with edits, staying after text typed right at them', () => {
    let state = EditorState.create({ doc: 'Hello world', extensions: [imageSpots] });
    state = state.update({ effects: addSpot.of({ id: 1, pos: 6 }) }).state;
    state = state.update({ changes: { from: 0, insert: 'Oh. ' } }).state;
    expect(state.field(imageSpots).get(1)).toBe(10);
    state = state.update({ changes: { from: 10, insert: 'big ' } }).state;
    expect(state.field(imageSpots).get(1)).toBe(14);
    // An image put there: the spot moves past it, so the next one goes after.
    state = state.update({ changes: imageLineChange(state, 14, line) }).state;
    expect(state.field(imageSpots).get(1)).toBe(
      state.doc.toString().indexOf(line) + line.length + 1,
    );
  });
});
