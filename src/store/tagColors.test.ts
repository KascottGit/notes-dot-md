import { describe, expect, it } from 'vitest';
import { fakeDrive } from '../drive/fakeDrive';
import { createNote, ensureFolders, getNote, setNoteProperties } from '../drive/notes';
import {
  checkTagName,
  MAX_SAVED_TAGS,
  nextTagColor,
  noteTagColors,
  savedTags,
  tagColorCss,
  tagColorProperty,
  type TagColors,
} from './tagColors';

describe('on the file', () => {
  it('reads a document’s saved tags from its app properties, skipping the rest', () => {
    expect(
      noteTagColors({ pinned: 'true', 'tag.school': 'green', 'tag.Work': 'blue', 'tag.x': 'neon' }),
    ).toEqual({ school: 'green', work: 'blue' });
  });

  it('stores one property per tag, in lower case, and removes it with null', () => {
    expect(tagColorProperty('School', 'green')).toEqual({ 'tag.school': 'green' });
    expect(tagColorProperty('school', null)).toEqual({ 'tag.school': null });
  });

  it('keeps each document’s tags apart in Drive', async () => {
    const { drive } = fakeDrive();
    const { defaultId } = await ensureFolders(drive);
    const a = await createNote(drive, defaultId, 'A', 'text #school');
    const b = await createNote(drive, defaultId, 'B', 'text #school');

    let saved = await setNoteProperties(drive, a, tagColorProperty('school', 'green'));
    saved = await setNoteProperties(drive, saved, tagColorProperty('work', 'blue'));
    expect(noteTagColors(saved.appProperties)).toEqual({ school: 'green', work: 'blue' });

    await setNoteProperties(drive, saved, tagColorProperty('school', null));
    expect(noteTagColors((await getNote(drive, a.id)).appProperties)).toEqual({ work: 'blue' });
    expect(noteTagColors((await getNote(drive, b.id)).appProperties)).toEqual({});
  });

  it('makes one style rule per colored tag', () => {
    expect(tagColorCss({ school: 'green', 'a"b': 'red' })).toBe(
      '[data-tag="school"] { --tag-color: var(--tag-green); }\n' +
        '[data-tag="a\\"b"] { --tag-color: var(--tag-red); }',
    );
  });
});

describe('saved tags', () => {
  it('lists them A–Z', () => {
    expect(savedTags({ work: 'blue', home: 'red' })).toEqual(['home', 'work']);
  });

  it('gives a new tag the first unused color', () => {
    expect(nextTagColor({})).toBe('red');
    expect(nextTagColor({ a: 'red', b: 'orange' })).toBe('yellow');
  });

  it('checks a new tag name', () => {
    expect(checkTagName(' #School ', {})).toEqual({ tag: 'school' });
    expect(checkTagName('work/notes', {})).toEqual({ tag: 'work/notes' });
    expect(checkTagName('', {})).toHaveProperty('error');
    expect(checkTagName('two words', {})).toHaveProperty('error');
    expect(checkTagName('123', {})).toHaveProperty('error');
    expect(checkTagName('home', { home: 'red' })).toEqual({ error: '#home is already saved.' });
  });

  it('keeps within what Drive can store on a file', () => {
    expect(checkTagName('a'.repeat(115), {})).toHaveProperty('error');
    expect(checkTagName('a'.repeat(110), {})).toEqual({ tag: 'a'.repeat(110) });
    const full: TagColors = Object.fromEntries(
      Array.from({ length: MAX_SAVED_TAGS }, (_, i) => [`t${i}`, 'red' as const]),
    );
    expect(checkTagName('one-more', full)).toEqual({
      error: `A note can have up to ${MAX_SAVED_TAGS} saved tags.`,
    });
  });
});
