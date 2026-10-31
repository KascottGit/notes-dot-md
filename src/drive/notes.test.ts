import { describe, expect, it } from 'vitest';
import { fakeDrive } from './fakeDrive';
import {
  APP_PROPERTIES,
  createFolder,
  createNote,
  ensureFolders,
  FOLDER_MIME,
  folderContents,
  getNote,
  isBoardNote,
  isPinned,
  listCategories,
  listNotes,
  listNotesIn,
  moveNote,
  readNote,
  renameNote,
  renameFolder,
  saveNote,
  setNoteType,
  setPinned,
  trashFolder,
  trashNote,
  untrashNote,
} from './notes';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  };
}

/** A Drive with Notes/ and Notes/General/ already set up. */
async function withFolders() {
  const fake = fakeDrive();
  const folders = await ensureFolders(fake.drive);
  return { ...fake, ...folders };
}

describe('ensureFolders', () => {
  it('creates Notes/ and Notes/General/ on first run, tagged as the app’s', async () => {
    const { drive, files } = fakeDrive();
    const storage = memoryStorage();

    const { rootId, defaultId } = await ensureFolders(drive, storage);

    const root = files.get(rootId)!;
    const general = files.get(defaultId)!;
    expect(root).toMatchObject({ name: 'Notes', mimeType: FOLDER_MIME, parents: ['root'] });
    expect(general).toMatchObject({ name: 'General', mimeType: FOLDER_MIME, parents: [rootId] });
    expect(root.appProperties).toEqual(APP_PROPERTIES);
    expect(general.appProperties).toEqual(APP_PROPERTIES);
    expect(storage.data.get('mdnotes.rootId')).toBe(rootId);
  });

  it('reuses existing folders instead of creating new ones', async () => {
    const { drive, files } = fakeDrive([
      { id: 'notes', name: 'Notes', mimeType: FOLDER_MIME, parents: ['root'] },
      { id: 'general', name: 'General', mimeType: FOLDER_MIME, parents: ['notes'] },
    ]);

    await expect(ensureFolders(drive)).resolves.toEqual({ rootId: 'notes', defaultId: 'general' });
    expect(files.size).toBe(2);
  });

  it('renames an Inbox from before to General, keeping the folder and its notes', async () => {
    const { drive, files } = fakeDrive([
      { id: 'notes', name: 'Notes', mimeType: FOLDER_MIME, parents: ['root'] },
      { id: 'inbox', name: 'Inbox', mimeType: FOLDER_MIME, parents: ['notes'] },
    ]);

    await expect(ensureFolders(drive)).resolves.toEqual({ rootId: 'notes', defaultId: 'inbox' });
    expect(files.get('inbox')!.name).toBe('General');
    expect(files.size).toBe(2);
  });

  it('keeps Inbox as a normal category when General already exists', async () => {
    const { drive, files } = fakeDrive([
      { id: 'notes', name: 'Notes', mimeType: FOLDER_MIME, parents: ['root'] },
      { id: 'general', name: 'General', mimeType: FOLDER_MIME, parents: ['notes'] },
      { id: 'inbox', name: 'Inbox', mimeType: FOLDER_MIME, parents: ['notes'] },
    ]);

    expect((await ensureFolders(drive)).defaultId).toBe('general');
    expect(files.get('inbox')!.name).toBe('Inbox');
  });

  it('picks the oldest root if there are two', async () => {
    const { drive } = fakeDrive([
      {
        id: 'newer',
        name: 'Notes',
        mimeType: FOLDER_MIME,
        createdTime: '2026-02-01T00:00:00Z',
      },
      { id: 'older', name: 'Notes', mimeType: FOLDER_MIME, createdTime: '2025-01-01T00:00:00Z' },
    ]);
    expect((await ensureFolders(drive)).rootId).toBe('older');
  });

  it('ignores a trashed Notes folder', async () => {
    const { drive } = fakeDrive([
      { id: 'old', name: 'Notes', mimeType: FOLDER_MIME, parents: ['root'], trashed: true },
    ]);
    expect((await ensureFolders(drive)).rootId).not.toBe('old');
  });

  it('uses the cached root id without searching', async () => {
    const { drive, calls } = fakeDrive([
      { id: 'cached', name: 'Notes', mimeType: FOLDER_MIME },
      { id: 'general', name: 'General', mimeType: FOLDER_MIME, parents: ['cached'] },
    ]);
    const storage = memoryStorage({ 'mdnotes.rootId': 'cached' });

    expect(await ensureFolders(drive, storage)).toEqual({ rootId: 'cached', defaultId: 'general' });
    const rootSearches = calls.filter((c) => c.url.searchParams.get('q')?.includes("'root'"));
    expect(rootSearches).toHaveLength(0);
  });

  it('searches again when the cached root was trashed or deleted', async () => {
    const { drive } = fakeDrive([
      { id: 'gone', name: 'Notes', mimeType: FOLDER_MIME, trashed: true },
      { id: 'real', name: 'Notes', mimeType: FOLDER_MIME, parents: ['root'] },
    ]);
    const storage = memoryStorage({ 'mdnotes.rootId': 'gone' });
    expect((await ensureFolders(drive, storage)).rootId).toBe('real');
    expect(storage.data.get('mdnotes.rootId')).toBe('real');

    storage.setItem('mdnotes.rootId', 'missing');
    expect((await ensureFolders(drive, storage)).rootId).toBe('real');
  });
});

describe('notes', () => {
  it('round-trips content exactly', async () => {
    const { drive, defaultId } = await withFolders();
    const content =
      '# Plan ☕\n\n- [ ] task\n- [x] done\n\n```ts\nconst a = "b";\n```\n\r\nend  \n';

    const note = await createNote(drive, defaultId, 'Plan', content);

    expect(await readNote(drive, note.id)).toBe(content);
  });

  it('creates <title>.md with markdown type and the app tag', async () => {
    const { drive, files, defaultId } = await withFolders();

    const note = await createNote(drive, defaultId, 'Drive: layer?');

    expect(note).toMatchObject({
      name: 'Drive layer.md',
      title: 'Drive layer',
      folderId: defaultId,
    });
    expect(files.get(note.id)).toMatchObject({
      mimeType: 'text/markdown',
      parents: [defaultId],
      appProperties: APP_PROPERTIES,
      content: '',
    });
  });

  it('adds (2) when a note with the same name exists', async () => {
    const { drive, defaultId } = await withFolders();
    await createNote(drive, defaultId, 'Untitled');
    const second = await createNote(drive, defaultId, 'Untitled');
    expect(second.name).toBe('Untitled (2).md');
  });

  it('saves new content and bumps the version', async () => {
    const { drive, defaultId } = await withFolders();
    const note = await createNote(drive, defaultId, 'A', 'one');

    const saved = await saveNote(drive, note.id, 'two');

    expect(await readNote(drive, note.id)).toBe('two');
    expect(Number(saved.version)).toBeGreaterThan(Number(note.version));
  });

  it('lists only markdown notes in a folder', async () => {
    const { drive, add, defaultId } = await withFolders();
    await createNote(drive, defaultId, 'Mine');
    add({ name: 'Uploaded.md', mimeType: 'application/octet-stream', parents: [defaultId] });
    add({ name: 'Old.markdown', mimeType: 'text/plain', parents: [defaultId] });
    add({ name: 'photo.jpg', mimeType: 'image/jpeg', parents: [defaultId] });
    add({ name: 'Doc', mimeType: 'application/vnd.google-apps.document', parents: [defaultId] });
    add({ name: 'Sub', mimeType: FOLDER_MIME, parents: [defaultId] });
    add({ name: 'Trashed.md', parents: [defaultId], trashed: true });
    add({ name: 'Elsewhere.md', parents: ['root'] });

    const titles = (await listNotes(drive, defaultId)).map((n) => n.title).sort();

    expect(titles).toEqual(['Mine', 'Old', 'Uploaded']);
  });

  it('follows pagination when listing', async () => {
    const { drive, add, defaultId } = await withFolders();
    for (let i = 0; i < 1001; i++) add({ name: `n${i}.md`, parents: [defaultId] });
    expect(await listNotes(drive, defaultId)).toHaveLength(1001);
  });

  it('lists categories by name', async () => {
    const { drive, rootId } = await withFolders();
    await createFolder(drive, rootId, 'School');
    await createFolder(drive, rootId, 'Projects');
    const names = (await listCategories(drive, rootId)).map((c) => c.name);
    expect(names).toEqual(['General', 'Projects', 'School']);
  });

  it('renames, keeping names unique', async () => {
    const { drive, defaultId } = await withFolders();
    await createNote(drive, defaultId, 'Taken');
    const note = await createNote(drive, defaultId, 'Draft');

    const renamed = await renameNote(drive, note, 'Final');
    expect(renamed).toMatchObject({ id: note.id, name: 'Final.md', title: 'Final' });

    const clash = await renameNote(drive, renamed, 'Taken');
    expect(clash.name).toBe('Taken (2).md');
  });

  it('renaming to the same title is a no-op', async () => {
    const { drive, calls, defaultId } = await withFolders();
    const note = await createNote(drive, defaultId, 'Same');
    const before = calls.length;
    expect(await renameNote(drive, note, 'Same')).toBe(note);
    expect(calls.length).toBe(before);
  });

  it('moves a note to another category', async () => {
    const { drive, files, rootId, defaultId } = await withFolders();
    const school = await createFolder(drive, rootId, 'School');
    const note = await createNote(drive, defaultId, 'Essay');

    const moved = await moveNote(drive, note, school.id);

    expect(moved.folderId).toBe(school.id);
    expect(files.get(note.id)!.parents).toEqual([school.id]);
    expect(moved.name).toBe('Essay.md');
  });

  it('renames on move when the name is taken in the target', async () => {
    const { drive, rootId, defaultId } = await withFolders();
    const school = await createFolder(drive, rootId, 'School');
    await createNote(drive, school.id, 'Essay');
    const note = await createNote(drive, defaultId, 'Essay');

    expect((await moveNote(drive, note, school.id)).name).toBe('Essay (2).md');
  });

  it('keeps a .markdown name on move when it is free', async () => {
    const { drive, add, rootId, defaultId } = await withFolders();
    const school = await createFolder(drive, rootId, 'School');
    add({ id: 'old', name: 'Old.markdown', parents: [defaultId] });
    const note = await getNote(drive, 'old');

    expect((await moveNote(drive, { ...note, folderId: defaultId }, school.id)).name).toBe(
      'Old.markdown',
    );
  });

  it('trashes instead of deleting', async () => {
    const { drive, files, calls, defaultId } = await withFolders();
    const note = await createNote(drive, defaultId, 'Bye');

    await trashNote(drive, note.id);

    expect(files.get(note.id)!.trashed).toBe(true);
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    expect(await listNotes(drive, defaultId)).toEqual([]);
  });
});

describe('categories', () => {
  it('renames a category folder', async () => {
    const { drive, files, rootId } = await withFolders();
    const school = await createFolder(drive, rootId, 'School');
    expect(await renameFolder(drive, school.id, 'University')).toEqual({
      id: school.id,
      name: 'University',
    });
    expect(files.get(school.id)!.name).toBe('University');
  });

  it('trashes a category folder instead of deleting it', async () => {
    const { drive, files, calls, rootId } = await withFolders();
    const old = await createFolder(drive, rootId, 'Old');
    await trashFolder(drive, old.id);
    expect(files.get(old.id)!.trashed).toBe(true);
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    expect((await listCategories(drive, rootId)).map((c) => c.name)).toEqual(['General']);
  });

  it('reports notes and other files in a folder', async () => {
    const { drive, add, rootId } = await withFolders();
    const school = await createFolder(drive, rootId, 'School');
    await createNote(drive, school.id, 'Essay');
    add({ name: 'photo.jpg', mimeType: 'image/jpeg', parents: [school.id] });
    add({ name: 'Gone.md', parents: [school.id], trashed: true });

    const { notes, otherFiles } = await folderContents(drive, school.id);

    expect(notes.map((n) => n.title)).toEqual(['Essay']);
    expect(otherFiles).toBe(1);
  });

  it('lists the notes of many categories, with the right category on each', async () => {
    const { drive, rootId, defaultId } = await withFolders();
    const ids = [defaultId];
    for (let i = 0; i < 30; i++) ids.push((await createFolder(drive, rootId, `C${i}`)).id);
    for (const id of ids) await createNote(drive, id, `Note in ${id}`);

    const notes = await listNotesIn(drive, ids);

    expect(notes).toHaveLength(31);
    for (const note of notes) expect(note.title).toBe(`Note in ${note.folderId}`);
  });
});

describe('pin and delete', () => {
  it('pins and unpins, keeping the app tag', async () => {
    const { drive, files, defaultId } = await withFolders();
    const note = await createNote(drive, defaultId, 'Plan');
    expect(isPinned(note)).toBe(false);

    const pinned = await setPinned(drive, note, true);
    expect(isPinned(pinned)).toBe(true);
    expect(files.get(note.id)!.appProperties).toEqual({ ...APP_PROPERTIES, pinned: 'true' });
    expect(isPinned((await listNotes(drive, defaultId))[0]!)).toBe(true);

    const unpinned = await setPinned(drive, pinned, false);
    expect(isPinned(unpinned)).toBe(false);
    expect(files.get(note.id)!.appProperties).toEqual(APP_PROPERTIES);
  });

  it('undo after delete takes the note out of the trash, content intact', async () => {
    const { drive, defaultId } = await withFolders();
    const note = await createNote(drive, defaultId, 'Oops', 'keep me');
    await trashNote(drive, note.id);
    expect(await listNotes(drive, defaultId)).toEqual([]);

    const back = await untrashNote(drive, note);

    expect(back.folderId).toBe(defaultId);
    expect((await listNotes(drive, defaultId)).map((n) => n.id)).toEqual([note.id]);
    expect(await readNote(drive, note.id)).toBe('keep me');
  });
});

describe('note type', () => {
  it('marks boards on the file, at creation or later', async () => {
    const { drive, files, defaultId } = await withFolders();
    const board = await createNote(drive, defaultId, 'Trip', 'x', { type: 'board' });
    expect(isBoardNote(board)).toBe(true);
    expect(files.get(board.id)!.appProperties).toEqual({ ...APP_PROPERTIES, type: 'board' });

    const note = await createNote(drive, defaultId, 'Plan');
    expect(isBoardNote(note)).toBe(false);
    const marked = await setNoteType(drive, note, true);
    expect(isBoardNote(marked)).toBe(true);
    expect(marked.modifiedTime).toBe(note.modifiedTime);
    const back = await setNoteType(drive, note, false);
    expect(isBoardNote(back)).toBe(false);
    expect(files.get(note.id)!.appProperties).toEqual(APP_PROPERTIES);
  });
});
