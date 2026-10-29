/**
 * Saving for the open note: autosave, conflict check, retries.
 *
 * Rules (SPEC "Saving and conflict handling"):
 * - Never lose text: on any failure the text stays in the editor.
 * - Never silently overwrite a newer Drive version: check the version first.
 */
import { AuthRequiredError } from '../auth/google';
import { DriveError, type DriveClient } from '../drive/client';
import { createNote, getNote, getNoteVersion, readNote, saveNote, type Note } from '../drive/notes';

export const AUTOSAVE_DELAY_MS = 2000;
export const RETRY_DELAYS_MS = [2000, 5000, 15000];

export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error';
export type ConflictChoice = 'theirs' | 'mine' | 'copy';

export interface SessionState {
  note: Note;
  status: SaveStatus;
  /** Shown with the "Couldn't save" status. */
  error: string | null;
  /** The note changed on Drive since it was loaded, and there are local edits. */
  conflict: boolean;
  readOnly: boolean;
}

/** The editor, as the session sees it. */
export interface TextPort {
  getText(): string;
  setText(text: string): void;
}

export class NoteSession {
  private note: Note;
  /** The text as last loaded from or saved to Drive. */
  private base: string;
  private status: SaveStatus = 'saved';
  private error: string | null = null;
  private conflict = false;
  private readonly readOnly: boolean;

  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempt = 0;
  private inflight: Promise<boolean> | null = null;
  private disposed = false;

  constructor(
    private readonly drive: DriveClient,
    note: Note,
    text: string,
    private readonly port: TextPort,
    private readonly onState: (state: SessionState) => void,
  ) {
    this.note = note;
    this.base = text;
    this.readOnly = !note.canEdit;
  }

  get state(): SessionState {
    return {
      note: this.note,
      status: this.status,
      error: this.error,
      conflict: this.conflict,
      readOnly: this.readOnly,
    };
  }

  /** The text as last loaded from or saved to Drive. Kept for three-way merges later. */
  get baseText(): string {
    return this.base;
  }

  isDirty(): boolean {
    return !this.readOnly && this.port.getText() !== this.base;
  }

  /** There is something a page close would lose. */
  hasUnsavedWork(): boolean {
    return this.isDirty() || this.inflight !== null;
  }

  /** Call on every user edit. */
  edited(): void {
    if (this.readOnly || this.disposed) return;
    if (this.status === 'saved' || this.status === 'unsaved') {
      this.setStatus(this.isDirty() ? 'unsaved' : 'saved');
    }
    if (this.conflict || this.retryTimer) return; // Don't save over a conflict or race a retry.
    this.clearAutosave();
    this.autosaveTimer = setTimeout(() => void this.save(), AUTOSAVE_DELAY_MS);
  }

  /** Save now (Ctrl+S, blur, page hidden). Resolves to true if Drive has the text. */
  save(): Promise<boolean> {
    this.clearAutosave();
    if (!this.inflight) {
      this.inflight = this.runSave().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  /**
   * Save until Drive has the current text. Resolves to false if that is not
   * possible right now (conflict or error); the text is still in the editor.
   */
  async flush(): Promise<boolean> {
    for (let i = 0; i < 3; i++) {
      if (this.inflight) await this.inflight;
      if (!this.isDirty()) return true;
      if (this.conflict || this.status === 'error') return false;
      if (!(await this.save()) && this.isDirty()) return false;
    }
    return !this.isDirty();
  }

  /** The "Retry" button after "Couldn't save". */
  retry(): Promise<boolean> {
    this.clearRetry();
    this.retryAttempt = 0;
    return this.save();
  }

  /**
   * On window focus: if the note changed elsewhere and there are no local
   * edits, load the new version silently.
   */
  async checkRemote(): Promise<void> {
    if (this.busy() || this.isDirty()) return;
    try {
      const remote = await getNoteVersion(this.drive, this.note.id);
      if (remote.version === this.note.version) return;
      const [note, text] = await Promise.all([
        getNote(this.drive, this.note.id),
        readNote(this.drive, this.note.id),
      ]);
      // The user may have typed while we were loading; then the save handles it.
      if (this.busy() || this.isDirty() || this.disposed) return;
      this.note = { ...note, folderId: this.note.folderId };
      this.base = text;
      this.port.setText(text);
      this.setStatus('saved');
    } catch {
      // Offline or similar; the next save checks again.
    }
  }

  /** Resolve a conflict. For 'copy', resolves to the new note holding the local text. */
  async resolveConflict(choice: ConflictChoice): Promise<Note | null> {
    if (!this.conflict) return null;
    try {
      if (choice === 'mine') {
        this.conflict = false;
        await this.write(this.port.getText());
        return null;
      }
      let copy: Note | null = null;
      if (choice === 'copy') {
        copy = await createNote(
          this.drive,
          this.note.folderId,
          `${this.note.title} (my copy)`,
          this.port.getText(),
        );
      }
      await this.loadTheirs();
      return copy;
    } catch (err) {
      this.conflict = choice !== 'mine';
      this.fail(err);
      return null;
    }
  }

  /**
   * Update metadata after a rename or move done elsewhere in the app. A save
   * may finish around the same time, so keep the newest version number.
   */
  updateNote(note: Note): void {
    if (note.id !== this.note.id) return;
    const version =
      Number(note.version) >= Number(this.note.version) ? note.version : this.note.version;
    this.note = { ...note, version };
    this.emit();
  }

  dispose(): void {
    this.disposed = true;
    this.clearAutosave();
    this.clearRetry();
  }

  private busy(): boolean {
    return (
      this.inflight !== null || this.conflict || this.status === 'error' || this.retryTimer !== null
    );
  }

  private async runSave(): Promise<boolean> {
    if (this.readOnly || this.conflict) return !this.isDirty();
    const text = this.port.getText();
    if (text === this.base) {
      this.error = null;
      this.setStatus('saved');
      return true;
    }
    this.setStatus('saving');
    try {
      const remote = await getNoteVersion(this.drive, this.note.id);
      if (remote.version !== this.note.version) {
        // Drive bumps the version for metadata changes too (a rename on another
        // device), so only call it a conflict if the content really changed.
        const theirs = await readNote(this.drive, this.note.id);
        if (theirs !== this.base) {
          this.conflict = true;
          this.setStatus('unsaved');
          return false;
        }
      }
      await this.write(text);
      return true;
    } catch (err) {
      return this.handleError(err);
    }
  }

  /** Upload `text` without a version check. */
  private async write(text: string): Promise<void> {
    this.setStatus('saving');
    const saved = await saveNote(this.drive, this.note.id, text);
    this.note = { ...saved, folderId: this.note.folderId };
    this.base = text;
    this.retryAttempt = 0;
    this.error = null;
    this.setStatus(this.isDirty() ? 'unsaved' : 'saved');
    if (this.isDirty()) this.edited(); // Typed during the upload; save that too.
  }

  private async loadTheirs(): Promise<void> {
    const [note, text] = await Promise.all([
      getNote(this.drive, this.note.id),
      readNote(this.drive, this.note.id),
    ]);
    this.note = { ...note, folderId: this.note.folderId };
    this.base = text;
    this.conflict = false;
    this.error = null;
    this.port.setText(text);
    this.setStatus('saved');
  }

  private handleError(err: unknown): boolean {
    if (isRetryable(err) && this.retryAttempt < RETRY_DELAYS_MS.length && !this.disposed) {
      const delay = RETRY_DELAYS_MS[this.retryAttempt++]!;
      this.setStatus('saving');
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        void this.save();
      }, delay);
      return false;
    }
    this.retryAttempt = 0;
    this.fail(err);
    return false;
  }

  private fail(err: unknown) {
    this.error = describeError(err);
    this.setStatus('error');
  }

  private setStatus(status: SaveStatus) {
    this.status = status;
    this.emit();
  }

  private emit() {
    if (!this.disposed) this.onState(this.state);
  }

  private clearAutosave() {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = null;
  }

  private clearRetry() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
}

/** Network failures (fetch throws TypeError), rate limits and server errors. */
function isRetryable(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  return err instanceof DriveError && (err.status === 429 || err.status >= 500);
}

function describeError(err: unknown): string {
  if (err instanceof AuthRequiredError) return 'You are signed out.';
  if (err instanceof DriveError && err.status === 404) {
    return 'This note no longer exists on Drive. Copy your text somewhere safe.';
  }
  if (err instanceof TypeError) return 'No connection to Google Drive.';
  return err instanceof Error ? err.message : String(err);
}
