<!-- The signed-in app: note list and editor. -->
<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
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
    readNote,
    renameFolder,
    renameNote,
    setPinned,
    isPinned,
    trashFolder,
    trashNote,
    untrashNote,
    type Category,
    type Folders,
    type Note,
  } from '../drive/notes';
  import { createEditor, type Editor } from '../editor/setup';
  import { loadSort, saveSort, sortCategories, type SortOrder } from '../store/noteList';
  import { NoteSession, type ConflictChoice, type SessionState } from '../store/noteSession';
  import { clearStash, readStash, saveStash, type Stash } from '../store/stash';
  import { safeLocalStorage } from '../store/storage';
  import ConflictDialog from './ConflictDialog.svelte';
  import NameDialog from './NameDialog.svelte';
  import NoteHeader from './NoteHeader.svelte';
  import NoteList from './NoteList.svelte';
  import Toast from './Toast.svelte';
  import { downloadFile } from './download';
  import Toolbar from './Toolbar.svelte';

  let folders = $state<Folders | null>(null);
  let categories = $state<Category[]>([]);
  let notes = $state<Note[]>([]);
  let loading = $state(true);
  /** Category filter; null = All notes. */
  let selectedCategory = $state<string | null>(null);
  let sort = $state<SortOrder>(loadSort());
  let query = $state('');
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
  /** Which pane shows on narrow screens. */
  let view = $state<'list' | 'editor'>('list');
  /** Leaving for Google's sign-in page, with unsaved text stashed. */
  let redirecting = false;
  let stopStashOnRedirect: (() => void) | null = null;

  onMount(() => {
    void loadList().then(restoreStash);
    stopStashOnRedirect = auth.onBeforeRedirect(() => {
      redirecting = true;
      stashOpenNote();
    });
    window.addEventListener('focus', onWindowFocus);
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onVisibilityChange);
  });

  onDestroy(() => {
    window.removeEventListener('focus', onWindowFocus);
    window.removeEventListener('beforeunload', onBeforeUnload);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    stopStashOnRedirect?.();
    session?.dispose();
    editor?.destroy();
  });

  async function loadList() {
    loading = true;
    listError = null;
    try {
      folders = await ensureFolders(drive, safeLocalStorage());
      await refreshList();
    } catch (err) {
      listError = `Couldn't load your notes: ${message(err)}`;
    } finally {
      loading = false;
    }
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
    return session?.hasUnsavedWork() ?? false;
  }

  async function openNote(note: Note, focus = false) {
    if (session && note.id === session.state.note.id) {
      view = 'editor';
      return;
    }
    openError = null;
    if (session && !(await session.flush())) {
      openError =
        "This note has changes that couldn't be saved yet. Resolve that before switching.";
      view = 'editor';
      return;
    }
    try {
      // Fresh metadata, so the conflict check starts from the real current version.
      const [fresh, text] = await Promise.all([getNote(drive, note.id), readNote(drive, note.id)]);
      const current = { ...fresh, folderId: note.folderId };
      show(current, text);
      if (focus) editor?.focus();
    } catch (err) {
      openError = `Couldn't open "${note.title}": ${message(err)}`;
    }
  }

  function show(note: Note, text: string) {
    session?.dispose();
    if (!editor && editorEl) {
      editor = createEditor({
        parent: editorEl,
        doc: text,
        readOnly: !note.canEdit,
        onChange: () => session?.edited(),
        onSave: () => void session?.save(),
        onBlur: () => void session?.save(),
      });
    } else {
      editor?.load(text, !note.canEdit);
    }
    const port = {
      getText: () => editor?.getText() ?? text,
      setText: (t: string) => editor?.setText(t),
    };
    session = new NoteSession(drive, note, text, port, onSessionState);
    sessionState = session.state;
    view = 'editor';
  }

  function onSessionState(state: SessionState) {
    sessionState = state;
    if (state.status === 'saved' && !redirecting) clearStash();
    // Keep the list in step with saves (modified time, name).
    notes = notes.map((n) => (n.id === state.note.id ? state.note : n));
  }

  async function newNote() {
    if (!folders) return;
    openError = null;
    if (session && !(await session.flush())) {
      openError =
        "This note has changes that couldn't be saved yet. Resolve that before switching.";
      return;
    }
    try {
      const note = await createNote(drive, selectedCategory ?? folders.defaultId, 'Untitled');
      notes = [...notes, note];
      show(note, '');
      await tick();
      header?.focusTitle();
    } catch (err) {
      openError = `Couldn't create a note: ${message(err)}`;
    }
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
    }
  }

  function message(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
</script>

<div class="workspace" data-view={view}>
  <aside>
    <NoteList
      {notes}
      {categories}
      defaultId={folders?.defaultId ?? null}
      {selectedCategory}
      selectedNoteId={sessionState?.note.id ?? null}
      {sort}
      {query}
      {loading}
      error={listError}
      onOpen={(note) => openNote(note)}
      onNew={newNote}
      onSelectCategory={(id) => (selectedCategory = id)}
      onSort={selectSort}
      onQuery={(q) => (query = q)}
      onNewCategory={() => (creatingCategory = true)}
      onRenameCategory={renameCategory}
      onDeleteCategory={deleteCategory}
      onTogglePin={togglePin}
      onDeleteNote={deleteNote}
    />
  </aside>

  <section class="main">
    {#if sessionState}
      <NoteHeader
        bind:this={header}
        {sessionState}
        {categories}
        onBack={() => (view = 'list')}
        onRetry={() => void session?.retry()}
        onRename={renameOpenNote}
        onMove={moveOpenNote}
        onDone={() => editor?.focus()}
        onExport={exportNote}
        onTogglePin={() => sessionState && void togglePin(sessionState.note)}
        onDelete={() => sessionState && void deleteNote(sessionState.note)}
      />
      {#if !sessionState.readOnly}
        <Toolbar run={(command) => editor?.run(command)} />
      {/if}
    {/if}
    {#if openError}
      <p class="open-error" role="alert">{openError}</p>
    {/if}
    {#if !sessionState}
      <p class="empty">Select a note, or create a new one.</p>
    {/if}
    <div class="editor" class:hidden={!sessionState} bind:this={editorEl}></div>
  </section>
</div>

{#if toast}
  <Toast
    message={toast.message}
    actionLabel={toast.action?.label}
    onAction={toast.action?.run}
    onClose={() => (toast = null)}
  />
{/if}

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
    min-height: 0;
    border-right: 1px solid var(--border);
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
  }
</style>
