<!-- The signed-in app: note list and editor. -->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { auth } from '../auth/google';
  import { drive } from '../drive/client';
  import {
    createNote,
    ensureFolders,
    getNote,
    listCategories,
    listNotes,
    readNote,
    type Category,
    type Folders,
    type Note,
  } from '../drive/notes';
  import { createEditor, type Editor } from '../editor/setup';
  import { NoteSession, type ConflictChoice, type SessionState } from '../store/noteSession';
  import { clearStash, readStash, saveStash, type Stash } from '../store/stash';
  import { safeLocalStorage } from '../store/storage';
  import ConflictDialog from './ConflictDialog.svelte';
  import NoteHeader from './NoteHeader.svelte';
  import NoteList from './NoteList.svelte';
  import Toolbar from './Toolbar.svelte';

  let folders: Folders | null = null;
  let categories = $state<Category[]>([]);
  let notes = $state<Note[]>([]);
  let loading = $state(true);
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

  const categoryName = (folderId: string) => categories.find((c) => c.id === folderId)?.name ?? '';

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
      categories = await listCategories(drive, folders.rootId);
      const perCategory = await Promise.all(categories.map((c) => listNotes(drive, c.id)));
      notes = perCategory.flat();
    } catch (err) {
      listError = `Couldn't load your notes: ${message(err)}`;
    } finally {
      loading = false;
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
      const note = await createNote(drive, folders.inboxId, 'Untitled');
      notes = [...notes, note];
      show(note, '');
      editor?.focus();
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
      selectedId={sessionState?.note.id ?? null}
      {categoryName}
      {loading}
      error={listError}
      onOpen={(note) => openNote(note)}
      onNew={newNote}
    />
  </aside>

  <section class="main">
    {#if sessionState}
      <NoteHeader
        state={sessionState}
        categoryName={categoryName(sessionState.note.folderId)}
        onBack={() => (view = 'list')}
        onRetry={() => void session?.retry()}
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

{#if sessionState}
  <ConflictDialog open={sessionState.conflict} title={sessionState.note.title} onChoose={resolve} />
{/if}

<style>
  .workspace {
    display: grid;
    grid-template-columns: 300px 1fr;
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
      grid-template-columns: 1fr;
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
