/**
 * Keeps the open note, and any text not yet on Drive, in sessionStorage
 * across a page reload: the sign-in redirect, or iOS discarding a
 * background tab. Never holds tokens.
 */
import { safeSessionStorage, type StorageLike } from './storage';

const KEY = 'mdnotes.stash';

export interface Stash {
  noteId: string;
  folderId: string;
  /** Drive version the unsaved text was based on. */
  version: string;
  /** Present only when there were unsaved edits. */
  unsaved?: { base: string; text: string };
}

export function saveStash(stash: Stash, storage: StorageLike | null = safeSessionStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(stash));
  } catch {
    // Full or blocked: the text is still in the editor.
  }
}

export function readStash(storage: StorageLike | null = safeSessionStorage()): Stash | null {
  try {
    const raw = storage?.getItem(KEY);
    return raw ? (JSON.parse(raw) as Stash) : null;
  } catch {
    return null;
  }
}

export function clearStash(storage: StorageLike | null = safeSessionStorage()): void {
  try {
    storage?.removeItem(KEY);
  } catch {
    // Ignore.
  }
}
