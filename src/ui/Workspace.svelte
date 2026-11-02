<!-- The signed-in app: note list and editor. -->
<script lang="ts">
  import { onDestroy, onMount, setContext, tick } from 'svelte';
  import { auth } from '../auth/google';
  import { drive } from '../drive/client';
  import { sanitizeCategoryName } from '../drive/names';
  import {
    createFolder,
    createNote,
    ensureFolders,
    folderContents,
    getNote,
    listCategories,
    listNotesIn,
    DEFAULT_FOLDER_NAME,
    moveNote,
    attachmentsFolder,
    readNote,
    searchNoteText,
    renameFolder,
    renameNote,
    setNoteProperties,
    setPinned,
    isBoardNote,
    isPinned,
    trashFolder,
    trashNote,
    untrashNote,
    type Category,
    type Folders,
    type Note,
  } from '../drive/notes';
  import { documentTags, isBoard, NEW_BOARD_TEXT } from '../editor/board';
  import type { TagSuggestion } from '../editor/tagComplete';
  import {
    checkTagName,
    loadTagColors,
    nextTagColor,
    savedTags,
    saveTagColor,
    tagColorCss,
    type TagColor,
    type TagColors,
  } from '../store/tagColors';
  import TagsDialog from './TagsDialog.svelte';
  import { createEditor, type Editor } from '../editor/setup';
  import {
    loadSort,
    matchesText,
    saveSort,
    sortCategories,
    type SortOrder,
  } from '../store/noteList';
  import {
    NoteSession,
    propertyChanges,
    type ConflictChoice,
    type SessionState,
  } from '../store/noteSession';
  import { clearStash, readStash, saveStash, type Stash } from '../store/stash';
  import { safeLocalStorage } from '../store/storage';
  import {
    firstStartInTab,
    hashForNote,
    loadLastNote,
    noteFromHash,
    saveLastNote,
  } from '../store/route';
  import type { Account } from '../drive/account';
  import Board from './Board.svelte';
  import ConflictDialog from './ConflictDialog.svelte';
  import IconButton from './IconButton.svelte';
  import NameDialog from './NameDialog.svelte';
  import NoteHeader from './NoteHeader.svelte';
  import NoteList from './NoteList.svelte';
  import Toast from './Toast.svelte';
  import { downloadFile } from './download';
  import Toolbar from './Toolbar.svelte';

  interface Props {
    account: Account | null;
    onSignOut: () => void;
    /** Dev builds only: drop the access token to test renewal. */
    onExpireToken?: (() => void) | undefined;
  }

  let { account, onSignOut, onExpireToken }: Props = $props();

  let folders = $state<Folders | null>(null);
  let categories = $state<Category[]>([]);
  let notes = $state<Note[]>([]);
  let loading = $state(true);
  /** Category filter; null = All notes. */
  let selectedCategory = $state<string | null>(null);
  let sort = $state<SortOrder>(loadSort());
  let query = $state('');
  /** Notes whose text matches the query, from Drive's full-text search. */
  let textMatches = $state<string[]>([]);
  let searching = $state(false);
  let searchFailed = $state(false);
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let searchSeq = 0;
  const SEARCH_DELAY_MS = 300;
  let lastListLoad = 0;
  /** The new-category dialog is open. */
  let creatingCategory = $state(false);
  let header = $state<NoteHeader>();
  let toast = $state<{ message: string; action?: { label: string; run: () => void } } | null>(null);
  let listError = $state<string | null>(null);
  let openError = $state<string | null>(null);

  let editorEl = $state<HTMLDivElement>();
  let editor: Editor | null = null;
  let session: NoteSession | null = null;
  let sessionState = $state<SessionState | null>(null);
  /** A note that was tapped and is still loading: its screen shows right away. */
  let opening = $state<Note | null>(null);
  /** Counts opens, so a slow load that was overtaken by another is dropped. */
  let openSeq = 0;
  /** The note header shows the loading note (title, category) until its text arrives. */
  /** A new note shown before its file exists in Drive; it is created in the background. */
  let creating = $state<Note | null>(null);
  /** The background creation: true once the file exists and the note is saved as usual. */
  let creatingTask: Promise<boolean> | null = null;
  const headerState = $derived<SessionState | null>(
    opening
      ? { note: opening, status: 'saved', error: null, conflict: false, readOnly: !opening.canEdit }
      : creating
        ? { note: creating, status: 'saved', error: null, conflict: false, readOnly: false }
        : sessionState,
  );
  /** Fade the text in once it has loaded (not on the very first open). */
  let fadeIn = $state(false);
  let board = $state<Board>();
  /** The open note's first line is the board marker. */
  let boardFile = $state(false);
  /** The user switched a board to its text. */
  let boardAsText = $state(false);
  const boardMode = $derived(boardFile && !boardAsText);
  /** The board's text, kept in step with the (hidden) editor, which stays the source of truth. */
  let boardText = $state('');
  /** Wider screens: the note list was hidden (remembered on this device). */
  const SIDEBAR_KEY = 'mdnotes.sidebarHidden';
  let sidebarHidden = $state(safeLocalStorage()?.getItem(SIDEBAR_KEY) === '1');
  /** Hidden only while a note is open; with nothing open the list is all there is. */
  const sidebarCollapsed = $derived(sidebarHidden && headerState !== null);

  function toggleSidebar() {
    sidebarHidden = !sidebarHidden;
    try {
      if (sidebarHidden) safeLocalStorage()?.setItem(SIDEBAR_KEY, '1');
      else safeLocalStorage()?.removeItem(SIDEBAR_KEY);
    } catch {
      // Only a preference.
    }
  }

  /** Which pane shows on narrow screens. */
  let view = $state<'list' | 'editor'>('list');
  /** Slide between list and note on phones, but not on the first screen. */
  let animate = $state(false);
  let firstView = true;
  $effect(() => {
    void view;
    if (firstView) firstView = false;
    else animate = true;
  });
  /**
   * The open note in the address bar (`#/n/<id>`), so a reload or bookmark
   * reopens it. On phones, opening a note adds a history entry, so Back
   * returns to the list; on wider screens the list is always shown, so the
   * entry is replaced instead.
   */
  const startRoute = noteFromHash(window.location.hash);
  /** False until the note from the URL (or the last note) has been reopened. */
  let routeReady = $state(false);
  /** history.back() was called; its popstate hasn't arrived yet. */
  let goingBack = false;
  const narrow = () => window.matchMedia('(max-width: 899px)').matches;
  const urlWith = (hash: string) => window.location.pathname + window.location.search + hash;
  const routeNoteId = $derived(opening?.id ?? sessionState?.note.id ?? null);

  $effect(() => {
    if (!routeReady || goingBack) return;
    const id = routeNoteId;
    const wanted = id && (view === 'editor' || !narrow()) ? hashForNote(id) : '';
    if (id) saveLastNote(id);
    if (window.location.hash === wanted) return;
    const pushed = window.history.state?.mdnotesNote === true;
    if (!wanted && pushed) {
      // Back to the list on a phone: undo the note's entry, like the browser's Back.
      goingBack = true;
      window.history.back();
    } else if (wanted && narrow() && !noteFromHash(window.location.hash)) {
      window.history.pushState({ mdnotesNote: true }, '', urlWith(wanted));
    } else {
      window.history.replaceState(pushed ? window.history.state : null, '', urlWith(wanted));
    }
  });

  /** The browser's Back or Forward (or an edited address): show what the URL says. */
  function onPopState() {
    goingBack = false;
    const id = noteFromHash(window.location.hash);
    if (!id) {
      view = 'list';
      return;
    }
    if (id === routeNoteId) {
      view = 'editor';
      return;
    }
    const note = notes.find((n) => n.id === id);
    if (note) void openNote(note);
    else window.history.replaceState(null, '', urlWith(''));
  }

  /**
   * On start: reopen unsaved text from before a reload, else the note in the
   * URL, else (in a new tab) the last open note. A note that is gone is skipped.
   */
  async function reopenOnStart() {
    const newTab = firstStartInTab();
    if (listError) return;
    // On phones, put the list under the note, so Back goes there (after a
    // reload, the note's own entry is still there).
    const pushed = window.history.state?.mdnotesNote === true;
    if (narrow() && startRoute && !pushed) window.history.replaceState(null, '', urlWith(''));
    if (readStash()) {
      routeReady = true;
      await restoreStash();
      return;
    }
    const last = loadLastNote();
    const id = startRoute ?? (newTab ? last : null);
    const note = id ? notes.find((n) => n.id === id) : undefined;
    if (id && !note && id === last) saveLastNote(null);
    routeReady = true;
    if (note) await openNote(note);
  }

  /** Leaving for Google's sign-in page, with unsaved text stashed. */
  let redirecting = false;
  let stopStashOnRedirect: (() => void) | null = null;

  onMount(() => {
    void loadList().then(reopenOnStart);
    stopStashOnRedirect = auth.onBeforeRedirect(() => {
      redirecting = true;
      stashOpenNote();
    });
    window.addEventListener('focus', onWindowFocus);
    window.addEventListener('popstate', onPopState);
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onVisibilityChange);
  });

  onDestroy(() => {
    window.removeEventListener('focus', onWindowFocus);
    window.removeEventListener('popstate', onPopState);
    window.removeEventListener('beforeunload', onBeforeUnload);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    stopStashOnRedirect?.();
    clearTimeout(searchTimer);
    session?.dispose();
    editor?.destroy();
  });

  async function loadList() {
    loading = true;
    listError = null;
    try {
      folders = await ensureFolders(drive, safeLocalStorage());
      void loadColors(folders.rootId);
      await refreshList();
    } catch (err) {
      listError = `Couldn't load your notes: ${message(err)}`;
    } finally {
      loading = false;
    }
  }

  /** `Notes/.attachments/`, found or created the first time a card image is added. */
  let imagesFolderId: Promise<string> | null = null;
  function imagesFolder(): Promise<string> {
    if (!folders) return Promise.reject(new Error('The notes folder is not loaded yet.'));
    if (!imagesFolderId) {
      imagesFolderId = attachmentsFolder(drive, folders.rootId);
      imagesFolderId.catch(() => (imagesFolderId = null));
    }
    return imagesFolderId;
  }

  /** Picked tag colors, from the settings file in Drive. */
  let tagColors = $state<TagColors>({});
  let tagsOpen = $state(false);

  async function loadColors(rootId: string) {
    try {
      tagColors = await loadTagColors(drive, rootId);
    } catch {
      // Tags keep the accent color; the next start tries again.
    }
  }

  /** One style sheet gives every colored tag its color, wherever it shows. */
  $effect(() => {
    const css = tagColorCss(tagColors);
    let sheet = document.getElementById('mdnotes-tag-colors');
    if (!sheet) {
      sheet = document.createElement('style');
      sheet.id = 'mdnotes-tag-colors';
      document.head.append(sheet);
    }
    sheet.textContent = css;
  });

  let addingTag = $state(false);
  /** The tag whose color swatches show in the Tags list. */
  let expandedTag = $state<string | null>(null);

  /**
   * Tags to suggest while typing: the saved tags, then the other tags in the
   * open note or board (for a card, the whole board).
   */
  function tagSuggestions(): TagSuggestion[] {
    const saved = savedTags(tagColors);
    const local = editor && sessionState ? documentTags(editor.getText()) : [];
    return [
      ...saved.map((tag) => ({ tag, saved: true })),
      ...local.filter((t) => !(t.toLowerCase() in tagColors)).map((tag) => ({ tag, saved: false })),
    ];
  }
  // Board cards have their own small editors; they get the tags from here.
  setContext('tags', tagSuggestions);

  /** Save a new tag with the next free color, and show its swatches. */
  async function addTag(raw: string): Promise<string | null> {
    const checked = checkTagName(raw, tagColors);
    if ('error' in checked) return checked.error;
    expandedTag = checked.tag;
    // Shows at once; saved to Drive in the background, so the dialog closes right away.
    void pickTagColor(checked.tag, nextTagColor(tagColors));
    return null;
  }

  /** Remove a saved tag (the text in notes stays), with Undo. */
  function removeTag(tag: string) {
    const color = tagColors[tag];
    if (!color) return;
    void pickTagColor(tag, null);
    toast = {
      message: `#${tag} removed from saved tags`,
      action: { label: 'Undo', run: () => void pickTagColor(tag, color) },
    };
  }

  /** Color changes shown already but not yet in Drive (lower-case tag → color, null: removed). */
  // Not shown directly (tagColors is), so a plain Map.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const unsavedColors = new Map<string, TagColor | null>();
  /** Saves run one after another, so each reads what the one before wrote. */
  let colorSaves: Promise<void> = Promise.resolve();

  /** Colors as saved, with the changes still on their way on top. */
  function withUnsaved(colors: TagColors): TagColors {
    const next = { ...colors };
    for (const [tag, color] of unsavedColors) {
      if (color) next[tag] = color;
      else delete next[tag];
    }
    return next;
  }

  /**
   * Set a saved tag's color, or remove the tag (null). Shows everywhere at
   * once; Drive is updated in the background.
   */
  function pickTagColor(tag: string, color: TagColor | null): Promise<void> {
    const rootId = folders?.rootId;
    if (!rootId) return Promise.resolve();
    const key = tag.toLowerCase();
    const before = tagColors[key] ?? null;
    unsavedColors.set(key, color);
    tagColors = withUnsaved(tagColors);
    colorSaves = colorSaves.then(async () => {
      try {
        const saved = await saveTagColor(drive, rootId, key, color);
        if (unsavedColors.get(key) === color) unsavedColors.delete(key);
        tagColors = withUnsaved(saved);
      } catch (err) {
        if (unsavedColors.get(key) === color) unsavedColors.delete(key);
        const back = { ...tagColors };
        if (before) back[key] = before;
        else delete back[key];
        tagColors = withUnsaved(back);
        toast = { message: `Couldn't save the color for #${key}: ${message(err)}` };
      }
    });
    return colorSaves;
  }

  /** Re-read categories and notes from Drive, so changes made there show up. */
  async function refreshList() {
    if (!folders) return;
    lastListLoad = Date.now();
    const found = await listCategories(drive, folders.rootId);
    const loaded = await listNotesIn(
      drive,
      found.map((c) => c.id),
    );
    categories = sortCategories(found, folders.defaultId);
    // The open note's metadata comes from its session, which is newer.
    const open = session?.state.note;
    notes = loaded.map((n) => (open && n.id === open.id ? open : n));
    if (selectedCategory && !found.some((c) => c.id === selectedCategory)) {
      selectedCategory = null;
    }
  }

  /**
   * Keep the open note (and unsaved text) in this tab across a reload: the
   * sign-in redirect, or iOS discarding the tab in the background.
   */
  function stashOpenNote() {
    if (!session || !editor) return;
    const { note } = session.state;
    saveStash({
      noteId: note.id,
      folderId: note.folderId,
      version: note.version,
      ...(session.isDirty() ? { unsaved: { base: session.baseText, text: editor.getText() } } : {}),
    });
  }

  /** After a reload: reopen the note, and put back text that wasn't saved yet. */
  async function restoreStash() {
    const stash = readStash();
    if (!stash || listError) return;
    try {
      const [fresh, text] = await Promise.all([
        getNote(drive, stash.noteId),
        readNote(drive, stash.noteId),
      ]);
      const note = { ...fresh, folderId: stash.folderId };
      if (!stash.unsaved || stash.unsaved.text === text) {
        show(note, text);
        clearStash();
        return;
      }
      restoreUnsaved(note, stash as Required<Stash>);
    } catch (err) {
      // Keep the stash so the text isn't lost; it is tried again on the next load.
      openError = `Couldn't reopen your last note: ${message(err)}`;
    }
  }

  function restoreUnsaved(note: Note, stash: Required<Stash>) {
    // Start from the version the edits were based on, so saving runs the
    // normal conflict check if the note changed on Drive in the meantime.
    show({ ...note, version: stash.version }, stash.unsaved.base);
    editor?.setText(stash.unsaved.text);
    session?.edited();
    void session?.save();
  }

  /** Save the open note before leaving it. False if its text can't be saved right now. */
  export async function flush(): Promise<boolean> {
    return session ? session.flush() : true;
  }

  /** Edits not yet on Drive, or a save in progress. */
  export function hasUnsavedWork(): boolean {
    return creating !== null || (session?.hasUnsavedWork() ?? false);
  }

  /**
   * Notes opened recently, with their text as last loaded or saved, newest
   * last. In memory only. Reopening one shows it at once, then checks Drive.
   */
  // Not shown anywhere, so a plain (non-reactive) Map.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const recent = new Map<string, { note: Note; text: string }>();
  const RECENT_MAX = 20;

  function remember(note: Note, text: string) {
    recent.delete(note.id);
    recent.set(note.id, { note, text });
    if (recent.size > RECENT_MAX) recent.delete(recent.keys().next().value!);
  }

  /**
   * Titles filter as you type; the note text is searched on Drive once typing
   * pauses. Notes kept in memory are matched here too, since Drive takes a
   * moment to index new text.
   */
  function search(q: string) {
    query = q;
    clearTimeout(searchTimer);
    const seq = ++searchSeq;
    searchFailed = false;
    if (!q.trim()) {
      textMatches = [];
      searching = false;
      return;
    }
    searching = true;
    searchTimer = setTimeout(async () => {
      const local = [...recent.values()]
        .filter((r) => matchesText(r.text, q))
        .map((r) => r.note.id);
      const open = sessionState?.note.id;
      if (open && editor && matchesText(editor.getText(), q)) local.push(open);
      let found: string[] = [];
      try {
        found = await searchNoteText(
          drive,
          categories.map((c) => c.id),
          q,
        );
      } catch {
        if (seq === searchSeq) searchFailed = true;
      }
      if (seq !== searchSeq) return;
      textMatches = [...new Set([...found, ...local])];
      searching = false;
    }, SEARCH_DELAY_MS);
  }

  /** Stop showing a note that is still loading (its result is dropped). */
  function cancelOpening() {
    openSeq++;
    opening = null;
  }

  /**
   * Open a note: its screen (title, category) shows at once, and the text
   * follows when Drive has sent it.
   */
  async function openNote(note: Note, focus = false) {
    if (session && note.id === session.state.note.id) {
      // Back to the note that is already open, from a slow load or the list.
      if (opening) openError = null;
      cancelOpening();
      view = 'editor';
      return;
    }
    if (opening?.id === note.id) {
      view = 'editor';
      return;
    }
    const seq = ++openSeq;
    openError = null;
    // A new note still being created: let it finish, so its text is saved.
    if (creatingTask) {
      if (!(await settleCreating()) || seq !== openSeq) return;
      if (session && note.id === session.state.note.id) {
        view = 'editor';
        return;
      }
    }
    const cached = recent.get(note.id);
    // Fresh metadata, so the conflict check starts from the real current version.
    // Fetched while the current note saves, so the two waits overlap.
    const loaded = cached ? null : Promise.all([getNote(drive, note.id), readNote(drive, note.id)]);
    loaded?.catch(() => {}); // Handled below; may be dropped if the switch is refused.
    if (session && session.hasUnsavedWork()) {
      if (!(await session.flush())) {
        if (seq !== openSeq) return;
        openError =
          "This note has changes that couldn't be saved yet. Resolve that before switching.";
        view = 'editor';
        return;
      }
      if (seq !== openSeq) return;
    }
    if (cached) {
      // Seen before: show that text now, then check Drive like on window focus.
      // The version stays the one the text belongs to, so a newer one is noticed.
      const newer = Number(note.version) > Number(cached.note.version);
      const meta = newer ? note : cached.note;
      show({ ...meta, version: cached.note.version, folderId: note.folderId }, cached.text);
      if (focus) editor?.focus();
      void session?.checkRemote();
      return;
    }
    if (!loaded) return; // (Only when cached, handled above.)
    opening = note;
    view = 'editor';
    try {
      const [fresh, text] = await loaded;
      if (seq !== openSeq) return;
      // Went back to the list while it loaded (phones): fill it in, but stay there.
      // (The cast: TypeScript can't see that the Back button changed `view` during the await.)
      const stay = (view as 'list' | 'editor') === 'list';
      show({ ...fresh, folderId: note.folderId }, text, true);
      if (stay) view = 'list';
      else if (focus) editor?.focus();
    } catch (err) {
      if (seq !== openSeq) return;
      openError = `Couldn't open "${note.title}": ${message(err)}`;
    }
  }

  /** Try a note that failed to load again. */
  function retryOpen() {
    const note = opening;
    if (!note) return;
    cancelOpening();
    void openNote(note);
  }

  function show(note: Note, text: string, fade = false) {
    cancelOpening();
    remember(note, text);
    fadeIn = fade;
    session?.dispose();
    loadText(text, !note.canEdit);
    void syncNoteProperties(note, text);
    attachSession(note, text);
    view = 'editor';
  }

  /** Put a text in the editor (and the board view), with an empty undo history. */
  function loadText(text: string, readOnly: boolean) {
    if (!editor && editorEl) {
      editor = createEditor({
        parent: editorEl,
        doc: text,
        readOnly,
        onChange: () => session?.edited(),
        onDocChange: syncBoard,
        onSave: () => void session?.save(),
        onBlur: () => void session?.save(),
        tags: tagSuggestions,
      });
    } else {
      editor?.load(text, readOnly);
    }
    boardAsText = false;
    boardFile = isBoard(text);
    boardText = text;
  }

  /** Save the editor's text to this note from now on. `text` is what Drive has. */
  function attachSession(note: Note, text: string) {
    const port = {
      getText: () => editor?.getText() ?? text,
      setText: (t: string) => editor?.setText(t),
    };
    session = new NoteSession(drive, note, text, port, onSessionState);
    sessionState = session.state;
  }

  /** After any change to the text: is it (still) a board, and what does the board show. */
  function syncBoard() {
    if (!editor) return;
    boardFile = isBoard(editor.firstLine());
    if (boardFile && !boardAsText) boardText = editor.getText();
  }

  function toggleBoard() {
    boardAsText = !boardAsText;
    syncBoard();
  }

  /**
   * On open: correct the board mark and preview on the file (the list's icon
   * and preview line), e.g. after another tool changed the note. Saves keep
   * them in step after that.
   */
  async function syncNoteProperties(note: Note, text: string) {
    const changes = propertyChanges(note, text);
    if (!note.canEdit || Object.keys(changes).length === 0) return;
    try {
      replaceNote(await setNoteProperties(drive, note, changes));
    } catch {
      // Only the list depends on them; the next open or save tries again.
    }
  }

  function onSessionState(state: SessionState) {
    sessionState = state;
    if (state.status === 'saved' && session?.state.note.id === state.note.id) {
      remember(state.note, session.baseText);
    }
    if (state.status === 'saved' && !redirecting) clearStash();
    // Keep the list in step with saves (modified time, name).
    notes = notes.map((n) => (n.id === state.note.id ? state.note : n));
  }

  /**
   * A new note or board: its screen opens at once, with the title selected,
   * and the file is created in the background (SPEC "New note").
   */
  async function newNote(kind: 'note' | 'board' = 'note') {
    if (!folders) return;
    openError = null;
    if (!(await settleCreating())) return;
    if (session && !(await session.flush())) {
      openError =
        "This note has changes that couldn't be saved yet. Resolve that before switching.";
      return;
    }
    cancelOpening();
    const now = new Date().toISOString();
    const draft: Note = {
      id: '',
      name: 'Untitled.md',
      title: 'Untitled',
      folderId: selectedCategory ?? folders.defaultId,
      createdTime: now,
      modifiedTime: now,
      version: '0',
      canEdit: true,
      appProperties: kind === 'board' ? { type: 'board' } : {},
    };
    session?.dispose();
    session = null;
    sessionState = null;
    creating = draft;
    fadeIn = false;
    loadText(kind === 'board' ? NEW_BOARD_TEXT : '', false);
    view = 'editor';
    await tick();
    header?.focusTitle();
    creatingTask = createInBackground(draft);
  }

  /** Create the new note's file. Text typed and a title given meanwhile go along. */
  async function createInBackground(draft: Note): Promise<boolean> {
    const text = editor?.getText() ?? '';
    try {
      const note = await createNote(
        drive,
        draft.folderId,
        'Untitled',
        text,
        isBoard(text) ? { type: 'board' } : {},
      );
      notes = [...notes, note];
      const title = creating?.title ?? 'Untitled';
      creating = null;
      openError = null;
      remember(note, text);
      attachSession(note, text);
      // Typed while the file was being created: save it like any edit.
      if (editor && editor.getText() !== text) session?.edited();
      if (title !== 'Untitled') await renameOpenNote(title);
      return true;
    } catch (err) {
      openError = `Couldn't create the note: ${message(err)} Your text is still here.`;
      return false;
    }
  }

  /** Try creating the new note's file again. */
  function retryCreate() {
    if (!creating) return;
    openError = null;
    creatingTask = createInBackground(creating);
  }

  /**
   * Before leaving a new note: wait until its file exists. False (and a
   * message) if it couldn't be created, so its text isn't left behind.
   */
  async function settleCreating(): Promise<boolean> {
    if (!creatingTask) return true;
    if (await creatingTask) {
      creatingTask = null;
      return true;
    }
    openError = "This new note couldn't be created in Drive yet. Retry, or copy its text first.";
    view = 'editor';
    return false;
  }

  async function resolve(choice: ConflictChoice) {
    const copy = await session?.resolveConflict(choice);
    if (copy) notes = [...notes, copy];
  }

  function onWindowFocus() {
    void session?.checkRemote();
    // Pick up categories and notes changed in Drive, at most every 30 seconds.
    if (Date.now() - lastListLoad > 30_000) void refreshList().catch(() => {});
  }

  /** Put a changed note (rename, move) into the list and the open session. */
  function replaceNote(note: Note) {
    notes = notes.map((n) => (n.id === note.id ? note : n));
    if (session?.state.note.id === note.id) session.updateNote(note);
  }

  async function renameOpenNote(title: string) {
    if (creating) {
      // The file doesn't exist yet: it gets this title once it does.
      creating = { ...creating, title, name: `${title}.md` };
      return;
    }
    if (!session) return;
    openError = null;
    try {
      replaceNote(await renameNote(drive, session.state.note, title));
    } catch (err) {
      openError = `Couldn't rename the note: ${message(err)}`;
    }
  }

  async function moveOpenNote(folderId: string) {
    if (!session || folderId === session.state.note.folderId) return;
    openError = null;
    try {
      replaceNote(await moveNote(drive, session.state.note, folderId));
    } catch (err) {
      openError = `Couldn't move the note: ${message(err)}`;
    }
  }

  /** Download the open note's text, exactly as it is in the editor, as `<title>.md`. */
  function exportNote() {
    if (!sessionState || !editor) return;
    downloadFile(`${sessionState.note.title}.md`, editor.getText(), 'text/markdown');
  }

  async function togglePin(note: Note) {
    const current = notes.find((n) => n.id === note.id) ?? note;
    const pin = !isPinned(current);
    // Show it right away; Drive catches up.
    replaceNote({
      ...current,
      appProperties: { ...current.appProperties, pinned: pin ? 'true' : '' },
    });
    try {
      replaceNote(await setPinned(drive, current, pin));
    } catch (err) {
      replaceNote(current);
      toast = { message: `Couldn't ${pin ? 'pin' : 'unpin'} the note: ${message(err)}` };
    }
  }

  /** Move a note to the Drive trash, with Undo. */
  async function deleteNote(note: Note) {
    recent.delete(note.id);
    if (loadLastNote() === note.id) saveLastNote(null);
    if (opening?.id === note.id) {
      cancelOpening();
      openError = null;
      if (!session) view = 'list';
    }
    const isOpen = session?.state.note.id === note.id;
    if (isOpen && session) {
      // Save first, so Undo brings back the latest text. Don't wait forever
      // (an expired session would hold the save until the next sign-in).
      await Promise.race([session.flush(), new Promise((r) => setTimeout(r, 5000))]);
      session.dispose();
      session = null;
      sessionState = null;
      clearStash();
      view = 'list';
    }
    notes = notes.filter((n) => n.id !== note.id);
    try {
      await trashNote(drive, note.id);
      toast = {
        message: `"${note.title}" moved to trash`,
        action: { label: 'Undo', run: () => void restoreNote(note) },
      };
    } catch (err) {
      notes = [...notes, note];
      toast = { message: `Couldn't delete "${note.title}": ${message(err)}` };
    }
  }

  async function restoreNote(note: Note) {
    try {
      const back = await untrashNote(drive, note);
      notes = [...notes.filter((n) => n.id !== back.id), back];
    } catch (err) {
      toast = { message: `Couldn't restore "${note.title}". It is in the Google Drive trash.` };
      console.warn('Restore from trash failed:', err);
    }
  }

  function selectSort(order: SortOrder) {
    sort = order;
    saveSort(order);
  }

  /** Check a category name; returns an error message or the clean name. */
  function checkCategoryName(raw: string, except?: string): { name: string } | { error: string } {
    const name = sanitizeCategoryName(raw);
    if (!name) return { error: 'Please enter a name.' };
    const taken = categories.some(
      (c) => c.id !== except && c.name.toLowerCase() === name.toLowerCase(),
    );
    return taken ? { error: `There is already a category called "${name}".` } : { name };
  }

  async function createCategory(raw: string): Promise<string | null> {
    if (!folders) return null;
    const checked = checkCategoryName(raw);
    if ('error' in checked) return checked.error;
    try {
      const created = await createFolder(drive, folders.rootId, checked.name);
      categories = sortCategories([...categories, created], folders.defaultId);
      selectedCategory = created.id;
      return null;
    } catch (err) {
      return `Couldn't create the category: ${message(err)}`;
    }
  }

  /** Inline rename from the list. Problems show as a toast; the name stays as it was. */
  async function renameCategory(category: Category, raw: string) {
    if (!folders) return;
    const checked = checkCategoryName(raw, category.id);
    if ('error' in checked) {
      toast = { message: checked.error };
      return;
    }
    try {
      const renamed = await renameFolder(drive, category.id, checked.name);
      categories = sortCategories(
        categories.map((c) => (c.id === renamed.id ? renamed : c)),
        folders.defaultId,
      );
    } catch (err) {
      toast = { message: `Couldn't rename the category: ${message(err)}` };
    }
  }

  /**
   * Delete a category: only when empty, else offer to move its notes to General
   * first. The folder goes to the Drive trash.
   */
  async function deleteCategory(category: Category) {
    if (!folders || category.id === folders.defaultId) return;
    openError = null;
    try {
      const { notes: inside, otherFiles } = await folderContents(drive, category.id);
      if (otherFiles > 0) {
        alert(
          `"${category.name}" also holds ${otherFiles} file(s) that aren't notes. ` +
            'Move or delete those in Google Drive first.',
        );
        return;
      }
      if (inside.length > 0) {
        const plural = inside.length === 1 ? 'note' : 'notes';
        if (
          !confirm(
            `"${category.name}" has ${inside.length} ${plural}. Move them to ${DEFAULT_FOLDER_NAME} and delete the category?`,
          )
        ) {
          return;
        }
        // One at a time, so name clashes in General get (2), (3)... correctly.
        for (const note of inside) replaceNote(await moveNote(drive, note, folders.defaultId));
      } else if (!confirm(`Delete the category "${category.name}"? It goes to the Drive trash.`)) {
        return;
      }
      await trashFolder(drive, category.id);
      categories = categories.filter((c) => c.id !== category.id);
      if (selectedCategory === category.id) selectedCategory = null;
    } catch (err) {
      openError = `Couldn't delete the category: ${message(err)}`;
      void refreshList().catch(() => {});
    }
  }

  function onVisibilityChange() {
    if (document.visibilityState !== 'hidden') return;
    if (session?.isDirty()) stashOpenNote(); // In case iOS discards the tab.
    void session?.save();
  }

  function onBeforeUnload(event: BeforeUnloadEvent) {
    if (redirecting) return; // Unsaved text is stashed and restored after sign-in.
    if (session?.hasUnsavedWork()) {
      void session.save();
      event.preventDefault();
    } else if (creating) {
      event.preventDefault(); // A new note still being created in Drive.
    }
  }

  function message(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
</script>

<div class="workspace" data-view={view} class:animate class:collapsed={sidebarCollapsed}>
  <aside>
    <div class="brand">
      <span class="app">notes.md</span>
      {#if import.meta.env.DEV}<span class="dev">dev</span>{/if}
      <span class="email" title={account?.emailAddress}>{account?.emailAddress ?? ''}</span>
      {#if onExpireToken}
        <IconButton icon="expire" label="Expire token (dev)" onclick={onExpireToken} />
      {/if}
      <IconButton
        icon="tag"
        label="Tags"
        title="Tags and their colors"
        onclick={() => {
          expandedTag = null;
          tagsOpen = true;
        }}
      />
      <IconButton
        icon="logout"
        label="Sign out"
        title={account ? `Sign out (${account.emailAddress})` : 'Sign out'}
        onclick={onSignOut}
      />
    </div>
    <NoteList
      {notes}
      {categories}
      defaultId={folders?.defaultId ?? null}
      {selectedCategory}
      selectedNoteId={opening?.id ?? sessionState?.note.id ?? null}
      {sort}
      {query}
      {textMatches}
      {searching}
      {searchFailed}
      {loading}
      error={listError}
      onOpen={(note) => openNote(note)}
      onNew={() => newNote()}
      onNewBoard={() => newNote('board')}
      onSelectCategory={(id) => (selectedCategory = id)}
      onSort={selectSort}
      onQuery={search}
      onNewCategory={() => (creatingCategory = true)}
      onRenameCategory={renameCategory}
      onDeleteCategory={deleteCategory}
      onTogglePin={togglePin}
      onDeleteNote={deleteNote}
    />
  </aside>

  <section class="main">
    {#if headerState}
      <NoteHeader
        bind:this={header}
        sessionState={headerState}
        opening={opening ? (openError ? 'failed' : 'loading') : creating ? 'creating' : null}
        {categories}
        onBack={() => (view = 'list')}
        sidebarOpen={!sidebarCollapsed}
        onToggleSidebar={toggleSidebar}
        onRetry={() => void session?.retry()}
        onRename={renameOpenNote}
        onMove={moveOpenNote}
        onDone={() => editor?.focus()}
        onExport={exportNote}
        onTogglePin={() => sessionState && void togglePin(sessionState.note)}
        onDelete={() => sessionState && void deleteNote(sessionState.note)}
        boardView={boardFile ? (boardMode ? 'board' : 'text') : null}
        onToggleBoard={opening ? undefined : toggleBoard}
      />
      {#if opening}
        <!-- Shown already, so nothing jumps when the text arrives. -->
        {#if !headerState.readOnly}
          <Toolbar
            run={() => {}}
            disabled
            headingLevels={isBoardNote(opening) ? [3, 4, 5, 6] : [1, 2, 3]}
          />
        {/if}
      {:else if !headerState.readOnly}
        {#if boardMode}
          <Toolbar
            run={(command) => board?.run(command)}
            headingLevels={[3, 4, 5, 6]}
            onDueDate={() => board?.pickDueDate()}
          />
        {:else}
          <Toolbar run={(command) => editor?.run(command)} />
        {/if}
      {/if}
    {/if}
    {#if openError}
      <p class="open-error" role="alert">
        {openError}
        {#if opening}<button class="retry" onclick={retryOpen}>Retry</button>{/if}
        {#if creating}<button class="retry" onclick={retryCreate}>Retry</button>{/if}
      </p>
    {/if}
    {#if opening && !openError && isBoardNote(opening)}
      <!-- A board loading: placeholder columns and cards in the board's layout. -->
      <div class="placeholder-board" aria-busy="true" aria-label="Loading board">
        {#each [[70, 55, 80], [60, 75], [65]] as cards, i (i)}
          <div class="ph-column">
            <span class="line ph-title"></span>
            {#each cards as width, j (j)}
              <div class="ph-card"><span class="line" style:width={`${width}%`}></span></div>
            {/each}
          </div>
        {/each}
      </div>
    {:else if opening && !openError}
      <!-- Placeholder lines while the text loads; they show only if it takes a moment. -->
      <div class="placeholder" aria-busy="true" aria-label="Loading note">
        {#each [92, 78, 85, 40, 0, 88, 70] as width, i (i)}
          <span class="line" style:width={`${width}%`}></span>
        {/each}
      </div>
    {:else if !headerState}
      <p class="empty">Select a note, or create a new one.</p>
    {/if}
    {#if headerState && !opening && boardMode}
      <Board
        bind:this={board}
        text={boardText}
        readOnly={headerState.readOnly}
        onEdit={(text) => editor?.edit(text)}
        onSave={() => void session?.save()}
        onToast={(message, undo) => {
          toast = { message, ...(undo ? { action: { label: 'Undo', run: undo } } : {}) };
        }}
        {imagesFolder}
      />
    {/if}
    <div
      class="editor"
      class:hidden={!headerState || opening || boardMode}
      class:fade={fadeIn}
      bind:this={editorEl}
    ></div>
  </section>
</div>

{#snippet toastView()}
  {#if toast}
    <Toast
      message={toast.message}
      actionLabel={toast.action?.label}
      onAction={toast.action?.run}
      onClose={() => (toast = null)}
    />
  {/if}
{/snippet}
<!-- An open dialog makes the rest of the page untouchable, so the toast goes inside it. -->
{#if !tagsOpen}{@render toastView()}{/if}

<TagsDialog
  open={tagsOpen}
  colors={tagColors}
  bind:expanded={expandedTag}
  onPick={pickTagColor}
  onAdd={() => (addingTag = true)}
  onRemove={removeTag}
  onClose={() => (tagsOpen = false)}
>
  {#if tagsOpen}{@render toastView()}{/if}
</TagsDialog>

<NameDialog
  open={addingTag}
  title="New tag"
  label="Tag"
  confirmLabel="Add"
  onSubmit={addTag}
  onClose={() => (addingTag = false)}
/>

<NameDialog
  open={creatingCategory}
  title="New category"
  label="Name"
  confirmLabel="Create"
  onSubmit={createCategory}
  onClose={() => (creatingCategory = false)}
/>

{#if sessionState}
  <ConflictDialog open={sessionState.conflict} title={sessionState.note.title} onChoose={resolve} />
{/if}

<style>
  .workspace {
    display: grid;
    /* Wide enough for two columns of notes on larger screens. */
    grid-template-columns: clamp(300px, 36vw, 520px) minmax(0, 1fr);
    flex: 1;
    min-height: 0;
  }

  aside {
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-right: 1px solid var(--border);
  }

  /* Wider screens: the note list can be hidden; it slides closed and open. */
  @media (min-width: 900px) {
    .workspace {
      transition: grid-template-columns 200ms ease;
    }

    .workspace.collapsed {
      grid-template-columns: 0px minmax(0, 1fr);
    }

    aside {
      overflow: hidden;
    }

    /* Keep the list's width while it slides, so nothing inside reflows. */
    aside > * {
      min-width: clamp(300px, 36vw, 520px);
    }

    /* Hidden after the slide: not clickable and out of the Tab order. */
    .collapsed aside {
      border-right-color: transparent;
      visibility: hidden;
      transition: visibility 0s 200ms;
    }
  }

  aside > :global(.list) {
    flex: 1;
  }

  /* The app name and account, at the top of the note list. */
  .brand {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 52px;
    padding: 4px 4px 0 16px;
  }

  /* The name in the note text's serif, like the icon. */
  .app {
    font-family: var(--font-body);
    font-size: 1.1875rem;
    font-weight: 600;
  }

  .dev {
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--bg-muted);
    color: var(--text-muted);
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
  }

  .email {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--text-muted);
    font-size: 0.8125rem;
    text-align: right;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .main {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  .editor {
    flex: 1;
    min-height: 0;
  }

  .hidden {
    display: none;
  }

  .fade {
    animation: fade-in 180ms ease-out;
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }

  /* Lined up with the note text column. */
  .placeholder {
    display: flex;
    flex-direction: column;
    gap: 14px;
    width: 100%;
    max-width: 760px;
    margin: 0 auto;
    padding: 22px 22px;
    /* Only after a moment, so quick loads don't flash. */
    animation: fade-in 220ms ease-out 250ms backwards;
  }

  .placeholder .line,
  .placeholder-board .line {
    display: block;
    height: 12px;
    border-radius: 6px;
    background: var(--bg-muted);
  }

  /* The board's own layout (Board.svelte): 288px columns side by side, stacked on phones. */
  .placeholder-board {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px 16px 16px;
    overflow: hidden;
    animation: fade-in 220ms ease-out 250ms backwards;
  }

  .ph-column {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 8px;
    width: 288px;
    padding: 0 8px 12px;
    border-radius: 12px;
    background: var(--bg-muted);
  }

  .placeholder-board .ph-title {
    width: 35%;
    margin: 16px 7px 8px;
    background: var(--border);
  }

  .ph-card {
    height: 82px;
    padding: 16px 13px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg);
  }

  @media (max-width: 899px) {
    .placeholder-board {
      flex-direction: column;
      align-items: stretch;
      gap: 16px;
    }

    .ph-column {
      width: auto;
    }
  }

  /* The same as the Retry button after "Couldn't save" in the note header. */
  .open-error {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  .open-error .retry {
    min-height: 44px;
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-muted);
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }

  .empty {
    margin: auto;
    padding: 16px;
    color: var(--text-muted);
  }

  .open-error {
    margin: 0;
    padding: 8px 16px;
    background: var(--warning-bg);
    color: var(--danger);
    font-size: 0.875rem;
  }

  /* One pane at a time on narrow screens. */
  @media (max-width: 899px) {
    .workspace {
      /* minmax(0, …): long names must not make the pane wider than the screen. */
      grid-template-columns: minmax(0, 1fr);
    }

    aside {
      border-right: 0;
    }

    .workspace[data-view='list'] .main,
    .workspace[data-view='editor'] aside {
      display: none;
    }

    .workspace.animate[data-view='editor'] .main {
      animation: from-right 220ms ease-out;
    }

    .workspace.animate[data-view='list'] aside {
      animation: from-left 220ms ease-out;
    }

    @keyframes from-right {
      from {
        opacity: 0.6;
        transform: translateX(24%);
      }
    }

    @keyframes from-left {
      from {
        opacity: 0.6;
        transform: translateX(-24%);
      }
    }
  }
</style>
