/**
 * The open note in the address bar (`#/n/<fileId>`), and the last open note
 * for the next start. Notes are identified by Drive file id, never by title.
 * Pure helpers; the workspace does the history calls.
 */
import { safeLocalStorage, safeSessionStorage, type StorageLike } from './storage';

const LAST_NOTE_KEY = 'mdnotes.lastNote';
const TAB_KEY = 'mdnotes.tabStarted';

/** The note id in a URL fragment, or null for the note list. */
export function noteFromHash(hash: string): string | null {
  return hash.match(/^#\/n\/([\w-]+)$/)?.[1] ?? null;
}

/** The URL fragment for a note, or '' for the note list. */
export function hashForNote(id: string | null): string {
  return id ? `#/n/${id}` : '';
}

export function loadLastNote(storage: StorageLike | null = safeLocalStorage()): string | null {
  try {
    return storage?.getItem(LAST_NOTE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function saveLastNote(
  id: string | null,
  storage: StorageLike | null = safeLocalStorage(),
): void {
  try {
    if (id) storage?.setItem(LAST_NOTE_KEY, id);
    else storage?.removeItem(LAST_NOTE_KEY);
  } catch {
    // Only a convenience.
  }
}

/**
 * True the first time it is called in a browser tab. A new tab reopens the
 * last note; a reload in the same tab keeps what the address bar says.
 */
export function firstStartInTab(session: StorageLike | null = safeSessionStorage()): boolean {
  try {
    if (session?.getItem(TAB_KEY)) return false;
    session?.setItem(TAB_KEY, '1');
    return true;
  } catch {
    return true;
  }
}
