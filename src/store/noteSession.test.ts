import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDrive } from '../drive/fakeDrive';
import { createNote, ensureFolders, readNote, saveNote, type Note } from '../drive/notes';
import {
  AUTOSAVE_DELAY_MS,
  NoteSession,
  RETRY_DELAYS_MS,
  type SessionState,
  type TextPort,
} from './noteSession';

/** Stands in for the editor. */
function fakeEditor(initial: string): TextPort & { type(text: string): void; text: string } {
  return {
    text: initial,
    getText() {
      return this.text;
    },
    setText(text: string) {
      this.text = text;
    },
    type(text: string) {
      this.text = text;
    },
  };
}

async function setup(content = 'hello') {
  const fake = fakeDrive();
  const { defaultId } = await ensureFolders(fake.drive);
  const note = await createNote(fake.drive, defaultId, 'Note', content);
  const editor = fakeEditor(content);
  const states: SessionState[] = [];
  const session = new NoteSession(fake.drive, note, content, editor, (s) => states.push(s));
  const edit = (text: string) => {
    editor.type(text);
    session.edited();
  };
  /** Someone else saves the note from another device. */
  const remoteSave = (text: string) => saveNote(fake.drive, note.id, text);
  return { ...fake, defaultId, note, editor, session, states, edit, remoteSave };
}

const lastStatus = (states: SessionState[]) => states.at(-1)?.status;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('autosave', () => {
  it('saves 2 seconds after the last edit', async () => {
    const { session, edit, drive, note, states } = await setup();

    edit('hello w');
    expect(lastStatus(states)).toBe('unsaved');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 100);
    edit('hello world');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 100);
    expect(await readNote(drive, note.id)).toBe('hello');

    await vi.advanceTimersByTimeAsync(100);
    expect(await readNote(drive, note.id)).toBe('hello world');
    expect(lastStatus(states)).toBe('saved');
    expect(session.isDirty()).toBe(false);
  });

  it('shows saving while the upload runs', async () => {
    const { session, edit, states } = await setup();
    edit('x');
    const done = session.save();
    expect(lastStatus(states)).toBe('saving');
    await done;
    expect(lastStatus(states)).toBe('saved');
  });

  it('does not upload when the text is back to what Drive has', async () => {
    const { session, edit, calls } = await setup();
    edit('changed');
    edit('hello');
    const before = calls.length;
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(calls.length).toBe(before);
    expect(session.state.status).toBe('saved');
  });

  it('saves edits made during an upload afterwards', async () => {
    const { session, edit, editor, drive, note } = await setup();
    edit('one');
    const first = session.save();
    editor.type('one two'); // Typed while uploading.
    session.edited();
    await first;
    expect(session.state.status).toBe('unsaved');

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(await readNote(drive, note.id)).toBe('one two');
    expect(session.state.status).toBe('saved');
  });

  it('flush saves everything right away', async () => {
    const { session, edit, drive, note } = await setup();
    edit('now');
    await expect(session.flush()).resolves.toBe(true);
    expect(await readNote(drive, note.id)).toBe('now');
  });

  it('keeps base text next to the edited text', async () => {
    const { session, edit } = await setup('base');
    edit('edited');
    expect(session.baseText).toBe('base');
    await session.save();
    expect(session.baseText).toBe('edited');
  });
});

describe('conflicts', () => {
  it('does not overwrite a newer version from another device', async () => {
    const { session, edit, remoteSave, drive, note, states } = await setup();
    await remoteSave('theirs');
    edit('mine');

    await expect(session.save()).resolves.toBe(false);

    expect(await readNote(drive, note.id)).toBe('theirs');
    expect(session.state.conflict).toBe(true);
    expect(lastStatus(states)).toBe('unsaved');
  });

  it('stops autosaving until the conflict is resolved', async () => {
    const { session, edit, remoteSave, calls } = await setup();
    await remoteSave('theirs');
    edit('mine');
    await session.save();
    const before = calls.length;

    edit('mine, more');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 3);

    expect(calls.length).toBe(before);
    await expect(session.flush()).resolves.toBe(false);
  });

  it('ignores a version bump that did not change the content (e.g. a rename)', async () => {
    const { session, edit, drive, note } = await setup();
    await drive.request(`/drive/v3/files/${note.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Renamed.md' }),
    });
    edit('mine');

    await expect(session.save()).resolves.toBe(true);
    expect(await readNote(drive, note.id)).toBe('mine');
    expect(session.state.note.name).toBe('Renamed.md');
  });

  it('Load theirs replaces the editor text', async () => {
    const { session, edit, remoteSave, editor } = await setup();
    await remoteSave('theirs');
    edit('mine');
    await session.save();

    await session.resolveConflict('theirs');

    expect(editor.text).toBe('theirs');
    expect(session.state).toMatchObject({ conflict: false, status: 'saved' });
    // Saving again works normally against the new version.
    edit('theirs + mine');
    await expect(session.save()).resolves.toBe(true);
  });

  it('Keep mine overwrites Drive', async () => {
    const { session, edit, remoteSave, drive, note } = await setup();
    await remoteSave('theirs');
    edit('mine');
    await session.save();

    await session.resolveConflict('mine');

    expect(await readNote(drive, note.id)).toBe('mine');
    expect(session.state).toMatchObject({ conflict: false, status: 'saved' });
  });

  it('Save mine as a copy keeps both', async () => {
    const { session, edit, remoteSave, drive, note, editor, defaultId } = await setup();
    await remoteSave('theirs');
    edit('mine');
    await session.save();

    const copy = (await session.resolveConflict('copy')) as Note;

    expect(copy.name).toBe('Note (my copy).md');
    expect(copy.folderId).toBe(defaultId);
    expect(await readNote(drive, copy.id)).toBe('mine');
    expect(await readNote(drive, note.id)).toBe('theirs');
    expect(editor.text).toBe('theirs');
    expect(session.state.conflict).toBe(false);
  });
});

describe('remote changes on focus', () => {
  it('loads a newer version silently when there are no local edits', async () => {
    const { session, remoteSave, editor } = await setup();
    await remoteSave('from phone');

    await session.checkRemote();

    expect(editor.text).toBe('from phone');
    expect(session.state.status).toBe('saved');
  });

  it('leaves local edits alone (the next save shows the conflict)', async () => {
    const { session, remoteSave, edit, editor } = await setup();
    await remoteSave('from phone');
    edit('local');

    await session.checkRemote();

    expect(editor.text).toBe('local');
  });
});

describe('errors', () => {
  it('retries network errors after 2, 5 and 15 seconds, then shows Couldn’t save', async () => {
    const { session, edit, calls, setOffline, drive, note } = await setup();
    setOffline(true);

    edit('offline text');
    await session.save();
    expect(session.state.status).toBe('saving');

    let attempts = calls.length;
    for (const delay of RETRY_DELAYS_MS) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(calls.length).toBe(attempts); // Not before the delay.
      await vi.advanceTimersByTimeAsync(1);
      expect(calls.length).toBe(attempts + 1);
      attempts = calls.length;
    }
    expect(session.state.status).toBe('error');
    expect(session.state.error).toMatch(/connection/i);
    expect(session.isDirty()).toBe(true); // Text kept.

    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls.length).toBe(attempts); // No more automatic retries.

    setOffline(false);
    await expect(session.retry()).resolves.toBe(true);
    expect(session.state.status).toBe('saved');
    expect(await readNote(drive, note.id)).toBe('offline text');
  });

  it('recovers on its own if the network comes back during the retries', async () => {
    const { session, edit, setOffline, drive, note } = await setup();
    setOffline(true);
    edit('flaky');
    await session.save();

    setOffline(false);
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]!);

    expect(session.state.status).toBe('saved');
    expect(await readNote(drive, note.id)).toBe('flaky');
  });

  it('shows a clear error when the note was deleted elsewhere', async () => {
    const { session, edit, files, note } = await setup();
    files.delete(note.id);
    edit('orphan');

    await session.save();

    expect(session.state.status).toBe('error');
    expect(session.state.error).toMatch(/no longer exists/);
    expect(session.isDirty()).toBe(true);
  });

  it('a read-only note never saves', async () => {
    const fake = fakeDrive();
    const { defaultId } = await ensureFolders(fake.drive);
    const note = await createNote(fake.drive, defaultId, 'Shared', 'x');
    const editor = fakeEditor('x');
    const session = new NoteSession(fake.drive, { ...note, canEdit: false }, 'x', editor, () => {});
    editor.type('changed');
    session.edited();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(await readNote(fake.drive, note.id)).toBe('x');
    expect(session.state.readOnly).toBe(true);
  });
});

describe('metadata updates from rename or move', () => {
  it('takes the new name but keeps the newest version', async () => {
    const { session, note, edit } = await setup();
    edit('typed');
    await session.save(); // version goes up
    const saved = session.state.note.version;

    session.updateNote({ ...note, name: 'Renamed.md', title: 'Renamed', version: '1' });

    expect(session.state.note.title).toBe('Renamed');
    expect(session.state.note.version).toBe(saved);
  });

  it('a rename does not cause a conflict on the next save', async () => {
    const { session, note, drive, edit } = await setup();
    const { renameNote } = await import('../drive/notes');
    session.updateNote(await renameNote(drive, note, 'New name'));
    edit('after rename');
    await expect(session.save()).resolves.toBe(true);
    expect(session.state.conflict).toBe(false);
  });
});
