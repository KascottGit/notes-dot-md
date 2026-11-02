import { describe, expect, it } from 'vitest';
import { fakeDrive } from '../drive/fakeDrive';
import { ensureFolders, readSettings, SETTINGS_FILE } from '../drive/notes';
import {
  checkTagName,
  loadTagColors,
  nextTagColor,
  parseTagColors,
  savedTags,
  saveTagColor,
  setTagColorIn,
  tagColorCss,
} from './tagColors';

describe('settings text', () => {
  it('reads known colors and skips the rest', () => {
    expect(parseTagColors('{"tagColors":{"School":"green","x":"plaid","y":3}}')).toEqual({
      school: 'green',
    });
    expect(parseTagColors('')).toEqual({});
    expect(parseTagColors('not json')).toEqual({});
  });

  it('sets and removes one color, keeping other settings', () => {
    const text = '{"other":1,"tagColors":{"work":"blue"}}';
    const set = setTagColorIn(text, 'School', 'green');
    expect(JSON.parse(set)).toEqual({ other: 1, tagColors: { work: 'blue', school: 'green' } });
    expect(JSON.parse(setTagColorIn(set, 'work', null))).toEqual({
      other: 1,
      tagColors: { school: 'green' },
    });
  });

  it('makes one style rule per colored tag', () => {
    expect(tagColorCss({ school: 'green', 'work/notes': 'blue' })).toBe(
      '[data-tag="school"] { --tag-color: var(--tag-green); }\n' +
        '[data-tag="work/notes"] { --tag-color: var(--tag-blue); }',
    );
  });
});

describe('in Drive', () => {
  it('creates the settings file once, then merges changes into it', async () => {
    const { drive, files } = fakeDrive();
    const { rootId } = await ensureFolders(drive);
    expect(await loadTagColors(drive, rootId)).toEqual({});

    await saveTagColor(drive, rootId, 'school', 'green');
    // Another device adds a color in the meantime.
    const settings = [...files.values()].find((f) => f.name === SETTINGS_FILE)!;
    settings.content = setTagColorIn(settings.content, 'work', 'blue');

    expect(await saveTagColor(drive, rootId, 'home', 'red')).toEqual({
      school: 'green',
      work: 'blue',
      home: 'red',
    });
    expect([...files.values()].filter((f) => f.name === SETTINGS_FILE)).toHaveLength(1);
    expect((await readSettings(drive, rootId)).id).toBe(settings.id);
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
});
