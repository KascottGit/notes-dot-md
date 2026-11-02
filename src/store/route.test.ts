import { describe, expect, it } from 'vitest';
import { firstStartInTab, hashForNote, loadLastNote, noteFromHash, saveLastNote } from './route';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe('note routes', () => {
  it('reads and writes the note id in the fragment', () => {
    expect(noteFromHash('#/n/1AbC_d-9')).toBe('1AbC_d-9');
    expect(hashForNote('1AbC_d-9')).toBe('#/n/1AbC_d-9');
    expect(hashForNote(null)).toBe('');
  });

  it('treats anything else as the note list', () => {
    expect(noteFromHash('')).toBeNull();
    expect(noteFromHash('#')).toBeNull();
    expect(noteFromHash('#access_token=x')).toBeNull();
    expect(noteFromHash('#/n/')).toBeNull();
    expect(noteFromHash('#/n/a/b')).toBeNull();
  });
});

describe('last note and tab start', () => {
  it('remembers and forgets the last open note', () => {
    const storage = memoryStorage();
    expect(loadLastNote(storage)).toBeNull();
    saveLastNote('abc', storage);
    expect(loadLastNote(storage)).toBe('abc');
    saveLastNote(null, storage);
    expect(loadLastNote(storage)).toBeNull();
  });

  it('knows the first start in a tab', () => {
    const session = memoryStorage();
    expect(firstStartInTab(session)).toBe(true);
    expect(firstStartInTab(session)).toBe(false);
  });
});
