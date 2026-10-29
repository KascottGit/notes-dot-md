import { describe, expect, it } from 'vitest';
import type { Note } from '../drive/notes';
import {
  countByCategory,
  filterNotes,
  loadSort,
  saveSort,
  sortCategories,
  sortNotes,
} from './noteList';

function note(title: string, folderId: string, created: string, modified: string): Note {
  return {
    id: title,
    name: `${title}.md`,
    title,
    folderId,
    createdTime: created,
    modifiedTime: modified,
    version: '1',
    canEdit: true,
    appProperties: {},
  };
}

const notes = [
  note('Week 10 plan', 'school', '2026-01-03', '2026-01-04'),
  note('Café list', 'inbox', '2026-01-01', '2026-01-09'),
  note('Week 9 plan', 'school', '2026-01-02', '2026-01-02'),
];
const titles = (list: Note[]) => list.map((n) => n.title);

describe('filterNotes', () => {
  it('shows everything under All notes', () => {
    expect(filterNotes(notes, null, '')).toHaveLength(3);
  });

  it('filters by category', () => {
    expect(titles(filterNotes(notes, 'school', ''))).toEqual(['Week 10 plan', 'Week 9 plan']);
  });

  it('searches titles, ignoring case and accents, all words in any order', () => {
    expect(titles(filterNotes(notes, null, 'cafe'))).toEqual(['Café list']);
    expect(titles(filterNotes(notes, null, 'PLAN week'))).toEqual(['Week 10 plan', 'Week 9 plan']);
    expect(filterNotes(notes, 'inbox', 'plan')).toEqual([]);
  });
});

describe('sortNotes', () => {
  it('last modified, newest first (default)', () => {
    expect(titles(sortNotes(notes, 'modified'))).toEqual([
      'Café list',
      'Week 10 plan',
      'Week 9 plan',
    ]);
  });

  it('created, newest first', () => {
    expect(titles(sortNotes(notes, 'created'))).toEqual([
      'Week 10 plan',
      'Week 9 plan',
      'Café list',
    ]);
  });

  it('title A–Z, with numbers in numeric order', () => {
    expect(titles(sortNotes(notes, 'title'))).toEqual(['Café list', 'Week 9 plan', 'Week 10 plan']);
  });

  it('does not change the input', () => {
    const copy = [...notes];
    sortNotes(notes, 'title');
    expect(notes).toEqual(copy);
  });
});

describe('categories', () => {
  it('counts notes per category', () => {
    const counts = countByCategory(notes);
    expect(counts.get('school')).toBe(2);
    expect(counts.get('inbox')).toBe(1);
  });

  it('puts Inbox first, then sorts by name', () => {
    const sorted = sortCategories(
      [
        { id: 's', name: 'School' },
        { id: 'i', name: 'Inbox' },
        { id: 'a', name: 'Archive' },
      ],
      'i',
    );
    expect(sorted.map((c) => c.name)).toEqual(['Inbox', 'Archive', 'School']);
  });
});

describe('sort preference', () => {
  function memoryStorage() {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    };
  }

  it('survives a reload', () => {
    const storage = memoryStorage();
    expect(loadSort(storage)).toBe('modified');
    saveSort('title', storage);
    expect(loadSort(storage)).toBe('title');
  });

  it('ignores unknown stored values', () => {
    const storage = memoryStorage();
    storage.setItem('mdnotes.sort', 'bogus');
    expect(loadSort(storage)).toBe('modified');
  });
});
