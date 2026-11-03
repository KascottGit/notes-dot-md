/**
 * The note list as last seen, kept on this device so the app can show it at
 * once on the next start and refresh it from Drive in the background
 * (SPEC "Note list"). Metadata only: no note text, never tokens. Kept per
 * account, and cleared on sign-out.
 */
import type { Category, Folders, Note } from '../drive/notes';
import { safeLocalStorage, type StorageLike } from './storage';

const KEY = 'mdnotes.listCache';
const VERSION = 1;

export interface ListCache {
  /** The account it belongs to (email). */
  account: string;
  folders: Folders;
  categories: Category[];
  notes: Note[];
}

/** The saved list for this account, or null. */
export function loadListCache(
  account: string | null,
  storage: StorageLike | null = safeLocalStorage(),
): ListCache | null {
  if (!account) return null;
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<ListCache> & { version?: number };
    if (value.version !== VERSION || value.account !== account) return null;
    if (!value.folders || !Array.isArray(value.notes) || !Array.isArray(value.categories)) {
      return null;
    }
    return {
      account,
      folders: value.folders,
      categories: value.categories,
      notes: value.notes,
    };
  } catch {
    return null;
  }
}

export function saveListCache(
  cache: ListCache,
  storage: StorageLike | null = safeLocalStorage(),
): void {
  try {
    storage?.setItem(KEY, JSON.stringify({ version: VERSION, ...cache }));
  } catch {
    // Full or blocked: the next start loads from Drive as before.
  }
}

export function clearListCache(storage: StorageLike | null = safeLocalStorage()): void {
  try {
    storage?.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
