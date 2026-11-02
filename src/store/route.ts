/**
 * The open note in the address bar (`#/n/<fileId>`). Notes are identified
 * by Drive file id, never by title. Pure helpers; the workspace does the
 * history calls.
 */
import { safeLocalStorage, type StorageLike } from './storage';

/** The note id in a URL fragment, or null for the note list. */
export function noteFromHash(hash: string): string | null {
  return hash.match(/^#\/n\/([\w-]+)$/)?.[1] ?? null;
}

/** The URL fragment for a note, or '' for the note list. */
export function hashForNote(id: string | null): string {
  return id ? `#/n/${id}` : '';
}

/**
 * Remove the last open note an earlier version kept to reopen it in a new
 * tab (no longer done: a new tab starts at the note list).
 */
export function forgetLastNote(storage: StorageLike | null = safeLocalStorage()): void {
  try {
    storage?.removeItem('mdnotes.lastNote');
  } catch {
    // Nothing to remove.
  }
}
