/**
 * Notes and categories on Google Drive.
 *
 *   My Drive/Notes/            app root
 *   My Drive/Notes/General/    default category (called Inbox before 2026-10-30)
 *   My Drive/Notes/<category>/<title>.md
 *
 * Notes are identified by Drive file id, never by path or title.
 * Nothing is ever hard-deleted: delete means `trashed: true`.
 */
import type { StorageLike } from '../store/storage';
import type { DriveClient } from './client';
import {
  fileNameForTitle,
  isMarkdownFileName,
  quoteQuery,
  titleFromFileName,
  uniqueFileName,
} from './names';

export const ROOT_FOLDER_NAME = 'Notes';
export const DEFAULT_FOLDER_NAME = 'General';
/** The default category's old name. A folder by that name is renamed on the next start. */
export const OLD_DEFAULT_FOLDER_NAME = 'Inbox';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const NOTE_MIME = 'text/markdown';
/** Tag on every file and folder the app creates. */
export const APP_PROPERTIES = { app: 'mdnotes' } as const;

const ROOT_ID_KEY = 'mdnotes.rootId';
const FILES = '/drive/v3/files';
const UPLOAD = '/upload/drive/v3/files';
const NOTE_FIELDS =
  'id,name,mimeType,createdTime,modifiedTime,version,parents,appProperties,capabilities(canEdit)';
const FOLDER_FIELDS = 'id,name';

export interface Note {
  id: string;
  /** Filename, including `.md`. The source of truth for the title. */
  name: string;
  /** Filename without the extension. */
  title: string;
  /** Category folder id. */
  folderId: string;
  createdTime: string;
  modifiedTime: string;
  /** Drive's version counter; changes on every content or metadata change. */
  version: string;
  canEdit: boolean;
  appProperties: Record<string, string>;
}

export interface Category {
  id: string;
  name: string;
}

export interface Folders {
  rootId: string;
  defaultId: string;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType?: string;
  createdTime?: string;
  modifiedTime?: string;
  version?: string;
  parents?: string[];
  trashed?: boolean;
  appProperties?: Record<string, string>;
  capabilities?: { canEdit?: boolean };
}

interface FileList {
  files: DriveFile[];
  nextPageToken?: string;
}

function toNote(file: DriveFile, folderId?: string): Note {
  return {
    id: file.id,
    name: file.name,
    title: titleFromFileName(file.name),
    folderId: folderId ?? file.parents?.[0] ?? '',
    createdTime: file.createdTime ?? '',
    modifiedTime: file.modifiedTime ?? '',
    version: file.version ?? '',
    canEdit: file.capabilities?.canEdit ?? true,
    appProperties: file.appProperties ?? {},
  };
}

/** Markdown notes only. With the full Drive scope, folders can hold anything. */
function isNoteFile(file: DriveFile): boolean {
  if (file.mimeType === FOLDER_MIME || file.mimeType?.startsWith('application/vnd.google-apps.')) {
    return false;
  }
  return file.mimeType === NOTE_MIME || isMarkdownFileName(file.name);
}

/** Run a files.list query and follow every page. */
async function listAll(drive: DriveClient, q: string, fields: string): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q,
      fields: `nextPageToken,files(${fields})`,
      pageSize: '1000',
      spaces: 'drive',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const page = await drive.json<FileList>(`${FILES}?${params}`);
    files.push(...page.files);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return files;
}

async function findFolder(
  drive: DriveClient,
  parentId: string,
  name: string,
): Promise<DriveFile | null> {
  const q = [
    `name = ${quoteQuery(name)}`,
    `mimeType = '${FOLDER_MIME}'`,
    `${quoteQuery(parentId)} in parents`,
    'trashed = false',
  ].join(' and ');
  const params = new URLSearchParams({
    q,
    fields: `files(${FOLDER_FIELDS})`,
    orderBy: 'createdTime', // If two devices both created one, always pick the oldest.
    pageSize: '1',
    spaces: 'drive',
  });
  const { files } = await drive.json<FileList>(`${FILES}?${params}`);
  return files[0] ?? null;
}

/** Create a folder, tagged as the app's. */
export async function createFolder(
  drive: DriveClient,
  parentId: string,
  name: string,
): Promise<Category> {
  const file = await drive.json<DriveFile>(`${FILES}?fields=${FOLDER_FIELDS}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME,
      parents: [parentId],
      appProperties: APP_PROPERTIES,
    }),
  });
  return { id: file.id, name: file.name };
}

async function isLiveFolder(drive: DriveClient, id: string): Promise<boolean> {
  try {
    const file = await drive.json<DriveFile>(`${FILES}/${id}?fields=id,mimeType,trashed`);
    return file.mimeType === FOLDER_MIME && !file.trashed;
  } catch {
    return false; // Deleted, or another account's folder.
  }
}

/**
 * Find (or on first run, create) `Notes/` and `Notes/General/`. An `Inbox/`
 * from before the rename becomes `General/`: same folder, same notes.
 * The root id is cached in localStorage and re-checked on every start.
 */
export async function ensureFolders(
  drive: DriveClient,
  storage: StorageLike | null = null,
): Promise<Folders> {
  let rootId = readCache(storage);
  if (!rootId || !(await isLiveFolder(drive, rootId))) {
    const found = await findFolder(drive, 'root', ROOT_FOLDER_NAME);
    rootId = found?.id ?? (await createFolder(drive, 'root', ROOT_FOLDER_NAME)).id;
    writeCache(storage, rootId);
  }
  let general: { id: string } | null = await findFolder(drive, rootId, DEFAULT_FOLDER_NAME);
  if (!general) {
    const old = await findFolder(drive, rootId, OLD_DEFAULT_FOLDER_NAME);
    general = old
      ? await renameFolder(drive, old.id, DEFAULT_FOLDER_NAME)
      : await createFolder(drive, rootId, DEFAULT_FOLDER_NAME);
  }
  return { rootId, defaultId: general.id };
}

/** Forget the cached root id, e.g. on sign out. */
export function clearFolderCache(storage: StorageLike | null): void {
  try {
    storage?.removeItem(ROOT_ID_KEY);
  } catch {
    // Ignore blocked storage.
  }
}

function readCache(storage: StorageLike | null): string | null {
  try {
    return storage?.getItem(ROOT_ID_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeCache(storage: StorageLike | null, rootId: string) {
  try {
    storage?.setItem(ROOT_ID_KEY, rootId);
  } catch {
    // The cache only saves one request per start.
  }
}

/** Category folders directly under `Notes/`, sorted by name. */
export async function listCategories(drive: DriveClient, rootId: string): Promise<Category[]> {
  const q = `${quoteQuery(rootId)} in parents and mimeType = '${FOLDER_MIME}' and trashed = false`;
  const files = await listAll(drive, q, FOLDER_FIELDS);
  return files
    .map((f) => ({ id: f.id, name: f.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Rename a category folder. */
export async function renameFolder(
  drive: DriveClient,
  id: string,
  name: string,
): Promise<Category> {
  const file = await drive.json<DriveFile>(`${FILES}/${id}?fields=${FOLDER_FIELDS}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return { id: file.id, name: file.name };
}

/** Move a category folder to the Drive trash. Never hard-deletes. */
export async function trashFolder(drive: DriveClient, id: string): Promise<void> {
  await drive.request(`${FILES}/${id}?fields=id`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  });
}

/** What a folder holds: notes, and other files (images, folders, Docs...). */
export async function folderContents(
  drive: DriveClient,
  folderId: string,
): Promise<{ notes: Note[]; otherFiles: number }> {
  const q = `${quoteQuery(folderId)} in parents and trashed = false`;
  const files = await listAll(drive, q, NOTE_FIELDS);
  const notes = files.filter(isNoteFile).map((f) => toNote(f, folderId));
  return { notes, otherFiles: files.length - notes.length };
}

/**
 * Markdown notes in all the given category folders, in as few requests as
 * possible (Drive queries can OR several parents together).
 */
export async function listNotesIn(drive: DriveClient, folderIds: string[]): Promise<Note[]> {
  const known = new Set(folderIds);
  const chunks: string[][] = [];
  for (let i = 0; i < folderIds.length; i += 25) chunks.push(folderIds.slice(i, i + 25));
  const pages = await Promise.all(
    chunks.map((ids) => {
      const parents = ids.map((id) => `${quoteQuery(id)} in parents`).join(' or ');
      return listAll(drive, `(${parents}) and trashed = false`, NOTE_FIELDS);
    }),
  );
  return pages
    .flat()
    .filter(isNoteFile)
    .map((f) =>
      toNote(
        f,
        f.parents?.find((p) => known.has(p)),
      ),
    );
}

/** Markdown notes in one category folder. */
export async function listNotes(drive: DriveClient, folderId: string): Promise<Note[]> {
  const q = `${quoteQuery(folderId)} in parents and trashed = false`;
  const files = await listAll(drive, q, NOTE_FIELDS);
  return files.filter(isNoteFile).map((f) => toNote(f, folderId));
}

/** Current metadata of one note. */
export async function getNote(drive: DriveClient, id: string): Promise<Note> {
  return toNote(await drive.json<DriveFile>(`${FILES}/${id}?fields=${NOTE_FIELDS}`));
}

/** Just the version and modified time, for conflict checks before saving. */
export async function getNoteVersion(
  drive: DriveClient,
  id: string,
): Promise<{ version: string; modifiedTime: string }> {
  return drive.json(`${FILES}/${id}?fields=version,modifiedTime`);
}

/** The note's markdown text, exactly as stored. */
export async function readNote(drive: DriveClient, id: string): Promise<string> {
  const res = await drive.request(`${FILES}/${id}?alt=media`);
  return res.text();
}

/** Names already used in a folder, for duplicate checks. */
async function namesInFolder(drive: DriveClient, folderId: string): Promise<string[]> {
  const q = `${quoteQuery(folderId)} in parents and trashed = false`;
  return (await listAll(drive, q, 'name')).map((f) => f.name);
}

/** Create a note as `<title>.md` in a category, with ` (2)` etc. if the name is taken. */
export async function createNote(
  drive: DriveClient,
  folderId: string,
  title: string,
  content = '',
): Promise<Note> {
  const name = uniqueFileName(title, await namesInFolder(drive, folderId));
  const metadata = {
    name,
    mimeType: NOTE_MIME,
    parents: [folderId],
    appProperties: APP_PROPERTIES,
  };
  const boundary = `mdnotes-${crypto.randomUUID()}`;
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${NOTE_MIME}; charset=UTF-8`,
    '',
    content,
    `--${boundary}--`,
    '',
  ].join('\r\n');

  const file = await drive.json<DriveFile>(`${UPLOAD}?uploadType=multipart&fields=${NOTE_FIELDS}`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return toNote(file, folderId);
}

/**
 * Replace a note's content. Returns the new metadata (with the new version).
 * The conflict check before saving lives in the save logic (M3).
 */
export async function saveNote(drive: DriveClient, id: string, content: string): Promise<Note> {
  const file = await drive.json<DriveFile>(
    `${UPLOAD}/${id}?uploadType=media&fields=${NOTE_FIELDS}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': `${NOTE_MIME}; charset=UTF-8` },
      body: content,
    },
  );
  return toNote(file);
}

/** Rename a note. The new name gets ` (2)` etc. if another file in the folder has it. */
export async function renameNote(drive: DriveClient, note: Note, title: string): Promise<Note> {
  if (fileNameForTitle(title) === note.name) return note;
  const taken = (await namesInFolder(drive, note.folderId)).filter((n) => n !== note.name);
  const name = uniqueFileName(title, taken);
  const file = await drive.json<DriveFile>(`${FILES}/${note.id}?fields=${NOTE_FIELDS}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return toNote(file, note.folderId);
}

/** Move a note to another category, renaming it if the name is taken there. */
export async function moveNote(drive: DriveClient, note: Note, toFolderId: string): Promise<Note> {
  if (toFolderId === note.folderId) return note;
  const taken = await namesInFolder(drive, toFolderId);
  const clash = taken.some((n) => n.toLowerCase() === note.name.toLowerCase());
  const name = clash ? uniqueFileName(note.title, taken) : note.name;
  const params = new URLSearchParams({
    addParents: toFolderId,
    removeParents: note.folderId,
    fields: NOTE_FIELDS,
  });
  const file = await drive.json<DriveFile>(`${FILES}/${note.id}?${params}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(name === note.name ? {} : { name }),
  });
  return toNote(file, toFolderId);
}

/** Pinned notes are listed first. Stored on the file, so pins sync between devices. */
export function isPinned(note: Note): boolean {
  return note.appProperties['pinned'] === 'true';
}

/** Pin or unpin a note (`appProperties.pinned`). */
export async function setPinned(drive: DriveClient, note: Note, pinned: boolean): Promise<Note> {
  const file = await drive.json<DriveFile>(`${FILES}/${note.id}?fields=${NOTE_FIELDS}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    // null removes the property.
    body: JSON.stringify({ appProperties: { pinned: pinned ? 'true' : null } }),
  });
  return toNote(file, note.folderId);
}

/** Take a note back out of the Drive trash (the Undo after deleting). */
export async function untrashNote(drive: DriveClient, note: Note): Promise<Note> {
  const file = await drive.json<DriveFile>(`${FILES}/${note.id}?fields=${NOTE_FIELDS}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: false }),
  });
  return toNote(file, note.folderId);
}

/** Move a note to the Drive trash. Never hard-deletes. */
export async function trashNote(drive: DriveClient, id: string): Promise<void> {
  await drive.request(`${FILES}/${id}?fields=id`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  });
}
