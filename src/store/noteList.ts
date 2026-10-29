/**
 * What the note list shows: filtering by category and title, sorting, counts.
 * Pure functions, no UI.
 */
import { isPinned, type Category, type Note } from '../drive/notes';
import { safeLocalStorage, type StorageLike } from './storage';

export type SortOrder = 'modified' | 'created' | 'title';

export const SORT_LABELS: Record<SortOrder, string> = {
  modified: 'Last modified',
  created: 'Created',
  title: 'Title A–Z',
};

const SORT_KEY = 'mdnotes.sort';

/** Lowercase and without accents, so "cafe" finds "Café". */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Notes in a category (null = all notes) whose title contains `query`. */
export function filterNotes(notes: Note[], folderId: string | null, query: string): Note[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return notes.filter((note) => {
    if (folderId && note.folderId !== folderId) return false;
    const title = fold(note.title);
    return words.every((w) => title.includes(w));
  });
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Newest first for the dates, alphabetical (numbers in order) for titles. */
export function sortNotes(notes: Note[], order: SortOrder): Note[] {
  const sorted = [...notes];
  switch (order) {
    case 'modified':
      return sorted.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
    case 'created':
      return sorted.sort((a, b) => b.createdTime.localeCompare(a.createdTime));
    case 'title':
      return sorted.sort((a, b) => collator.compare(a.title, b.title));
  }
}

/** Pinned notes go above all others; both groups keep the given order. */
export function splitPinned(notes: Note[]): { pinned: Note[]; others: Note[] } {
  return {
    pinned: notes.filter((n) => isPinned(n)),
    others: notes.filter((n) => !isPinned(n)),
  };
}

/** Number of notes per category folder id. */
export function countByCategory(notes: Note[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const note of notes) counts.set(note.folderId, (counts.get(note.folderId) ?? 0) + 1);
  return counts;
}

/** Inbox first, then the rest by name. */
export function sortCategories(categories: Category[], inboxId: string | null): Category[] {
  return [...categories].sort((a, b) => {
    if (a.id === inboxId) return -1;
    if (b.id === inboxId) return 1;
    return collator.compare(a.name, b.name);
  });
}

export function loadSort(storage: StorageLike | null = safeLocalStorage()): SortOrder {
  try {
    const value = storage?.getItem(SORT_KEY);
    return value && value in SORT_LABELS ? (value as SortOrder) : 'modified';
  } catch {
    return 'modified';
  }
}

export function saveSort(order: SortOrder, storage: StorageLike | null = safeLocalStorage()): void {
  try {
    storage?.setItem(SORT_KEY, order);
  } catch {
    // Only a preference.
  }
}
