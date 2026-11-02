/**
 * What the note list shows: filtering by category and title, sorting, counts.
 * Pure functions, no UI.
 */
import { isPinned, noteTags, type Category, type Note } from '../drive/notes';
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

function words(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean);
}

/** The text has every word of the query (any case or accents). */
export function matchesText(text: string, query: string): boolean {
  const folded = fold(text);
  return words(query).every((w) => folded.includes(w));
}

/** Notes in a category (null = all notes) whose title contains `query`. */
export function filterNotes(notes: Note[], folderId: string | null, query: string): Note[] {
  return notes.filter((note) => {
    if (folderId && note.folderId !== folderId) return false;
    return matchesText(note.title, query);
  });
}

/**
 * Search results in a category: notes whose title matches, then notes found
 * only in their text (ids from the full-text search). Both sorted.
 */
export function searchResults(
  notes: Note[],
  folderId: string | null,
  query: string,
  textMatches: readonly string[],
  order: SortOrder,
): { titles: Note[]; text: Note[] } {
  const titles = filterNotes(notes, folderId, query);
  const byTitle = new Set(titles.map((n) => n.id));
  const inText = new Set(textMatches);
  const text = notes.filter(
    (n) => (!folderId || n.folderId === folderId) && inText.has(n.id) && !byTitle.has(n.id),
  );
  return { titles: sortNotes(titles, order), text: sortNotes(text, order) };
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

/**
 * Every tag in use, with how many notes use it, most used first. `notes` give
 * their stored tags; `live` adds tag lists not saved yet (the open note).
 */
export function allTags(
  notes: readonly Note[],
  live: readonly (readonly string[])[] = [],
): { tag: string; count: number }[] {
  const counts = new Map<string, { tag: string; count: number }>();
  const add = (tags: readonly string[]) => {
    const seen = new Set<string>();
    for (const tag of tags) {
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = counts.get(key);
      if (entry) entry.count++;
      else counts.set(key, { tag, count: 1 });
    }
  };
  for (const note of notes) add(noteTags(note));
  for (const tags of live) add(tags);
  return [...counts.values()].sort((a, b) => b.count - a.count || collator.compare(a.tag, b.tag));
}

/** Number of notes per category folder id. */
export function countByCategory(notes: Note[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const note of notes) counts.set(note.folderId, (counts.get(note.folderId) ?? 0) + 1);
  return counts;
}

/** The default category (General) first, then the rest by name. */
export function sortCategories(categories: Category[], defaultId: string | null): Category[] {
  return [...categories].sort((a, b) => {
    if (a.id === defaultId) return -1;
    if (b.id === defaultId) return 1;
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
