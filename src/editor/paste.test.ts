import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { markdownSupport } from './language';
import { addSpot, imageLineChange, imageSpots, linkPaste } from './paste';

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

describe('pasting a web address over selected text', () => {
  /** `|` marks the selection's ends. Returns the new text with `|` at the cursor, or null. */
  const paste = (marked: string, clipboard: string) => {
    const anchor = marked.indexOf('|');
    const head = marked.lastIndexOf('|') - 1;
    const state = EditorState.create({
      doc: marked.replaceAll('|', ''),
      selection: { anchor, head },
      extensions: [markdownSupport()],
    });
    const spec = linkPaste(state, clipboard);
    if (!spec) return null;
    const next = state.update(spec).state;
    const at = next.selection.main.head;
    return `${next.doc.sliceString(0, at)}|${next.doc.sliceString(at)}`;
  };
  const url = 'https://example.com/a?b=1';

  it('makes the text a link, with the cursor after it', () => {
    expect(paste('See |the docs| here', url)).toBe(`See [the docs](${url})| here`);
    expect(paste('|word|', ` ${url}\n`)).toBe(`[word](${url})|`);
  });

  it('keeps an address with brackets whole', () => {
    expect(paste('|wiki|', 'https://en.wikipedia.org/wiki/A_(b)')).toBe(
      '[wiki](<https://en.wikipedia.org/wiki/A_(b)>)|',
    );
  });

  it('pastes as usual when it is not one address, or nothing is selected', () => {
    expect(paste('|word|', 'just text')).toBeNull();
    expect(paste('|word|', `${url} and more`)).toBeNull();
    expect(paste('wo||rd', url)).toBeNull();
  });

  it('pastes as usual over an address, a link, code, brackets or several lines', () => {
    expect(paste('|https://old.example|', url)).toBeNull();
    expect(paste('[|text|](https://old.example)', url)).toBeNull();
    expect(paste('`|code|`', url)).toBeNull();
    expect(paste('```\n|code|\n```', url)).toBeNull();
    expect(paste('|a [b]|', url)).toBeNull();
    expect(paste('|one\ntwo|', url)).toBeNull();
  });
});
