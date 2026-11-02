import { describe, expect, it } from 'vitest';
import type { Note } from '../drive/notes';
import { clearListCache, loadListCache, saveListCache, type ListCache } from './listCache';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  };
}

const note: Note = {
  id: 'n1',
  name: 'A.md',
  title: 'A',
  folderId: 'gen',
  createdTime: '2026-01-01',
  modifiedTime: '2026-01-02',
  version: '3',
  canEdit: true,
  appProperties: { preview: 'Hello' },
};
const cache: ListCache = {
  account: 'me@example.com',
  folders: { rootId: 'root', defaultId: 'gen' },
  categories: [{ id: 'gen', name: 'General' }],
  notes: [note],
  tagColors: { school: 'green' },
};

describe('list cache', () => {
  it('gives back the saved list for the same account only', () => {
    const storage = memoryStorage();
    saveListCache(cache, storage);
    expect(loadListCache('me@example.com', storage)).toEqual(cache);
    expect(loadListCache('someone@else.com', storage)).toBeNull();
    expect(loadListCache(null, storage)).toBeNull();
  });

  it('holds no note text', () => {
    const storage = memoryStorage();
    saveListCache(cache, storage);
    expect([...storage.data.values()].join()).not.toContain('"text"');
  });

  it('is gone after clearing, and ignores broken data', () => {
    const storage = memoryStorage();
    saveListCache(cache, storage);
    clearListCache(storage);
    expect(loadListCache('me@example.com', storage)).toBeNull();
    storage.setItem('mdnotes.listCache', '{broken');
    expect(loadListCache('me@example.com', storage)).toBeNull();
  });
});
