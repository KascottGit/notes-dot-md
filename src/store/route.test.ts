import { describe, expect, it } from 'vitest';
import { forgetLastNote, hashForNote, noteFromHash } from './route';

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

  it('forgets the last note an earlier version kept', () => {
    const data = new Map([['mdnotes.lastNote', 'abc']]);
    forgetLastNote({
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
      removeItem: (k) => void data.delete(k),
    });
    expect(data.has('mdnotes.lastNote')).toBe(false);
  });
});
