export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** localStorage, or null where it is missing or blocked (tests, some private modes). */
export function safeLocalStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
