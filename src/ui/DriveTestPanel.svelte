<!--
  Temporary panel for checking the Drive layer (M2) by hand.
  Replaced by the real note list and editor in M3 and M6.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { drive } from '../drive/client';
  import {
    createNote,
    ensureFolders,
    listCategories,
    listNotes,
    moveNote,
    readNote,
    renameNote,
    saveNote,
    trashNote,
    type Category,
    type Folders,
    type Note,
  } from '../drive/notes';
  import { safeLocalStorage } from '../store/storage';

  const SAMPLE = [
    '# Round trip ☕',
    '',
    '- [ ] open me in Drive',
    '- [x] created by notes.md',
    '',
    '```ts',
    'const quote = "unchanged";',
    '```',
    '',
  ].join('\n');

  let folders = $state<Folders | null>(null);
  let categories = $state<Category[]>([]);
  let folderId = $state('');
  let notes = $state<Note[]>([]);
  let open = $state<{ note: Note; text: string } | null>(null);
  let status = $state('Setting up the Notes folder…');
  let busy = $state(false);

  onMount(() => {
    void run('Notes folder ready', async () => {
      folders = await ensureFolders(drive, safeLocalStorage());
      folderId = folders.inboxId;
      await refresh();
    });
  });

  async function refresh() {
    if (!folders) return;
    categories = await listCategories(drive, folders.rootId);
    notes = (await listNotes(drive, folderId)).sort((a, b) =>
      b.modifiedTime.localeCompare(a.modifiedTime),
    );
  }

  /** Run one action, showing progress and errors. */
  async function run(done: string, action: () => Promise<void>) {
    busy = true;
    try {
      await action();
      status = done;
    } catch (err) {
      status = `Error: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      busy = false;
    }
  }

  function createTestNote() {
    let result = '';
    void run('', async () => {
      const note = await createNote(drive, folderId, 'Untitled', SAMPLE);
      const back = await readNote(drive, note.id);
      result =
        back === SAMPLE
          ? `Created ${note.name}. Round trip OK: the text read back is identical.`
          : `Created ${note.name}, but the text read back is DIFFERENT.`;
      await refresh();
    }).then(() => {
      if (result) status = result;
    });
  }

  function openNote(note: Note) {
    void run(`Opened ${note.name}`, async () => {
      open = { note, text: await readNote(drive, note.id) };
    });
  }

  function appendLine(note: Note) {
    void run(`Saved ${note.name}`, async () => {
      const text = await readNote(drive, note.id);
      const next = `${text}- [ ] added ${new Date().toLocaleTimeString()}\n`;
      await saveNote(drive, note.id, next);
      open = { note, text: await readNote(drive, note.id) };
      await refresh();
    });
  }

  function rename(note: Note) {
    const title = prompt('New title', note.title);
    if (title === null) return;
    void run('Renamed', async () => {
      const renamed = await renameNote(drive, note, title);
      status = `Renamed to ${renamed.name}`;
      await refresh();
    });
  }

  function move(note: Note, toId: string) {
    void run('Moved', async () => {
      await moveNote(drive, note, toId);
      if (open?.note.id === note.id) open = null;
      await refresh();
    });
  }

  function trash(note: Note) {
    if (!confirm(`Move "${note.name}" to the Drive trash?`)) return;
    void run(`Moved ${note.name} to the trash`, async () => {
      await trashNote(drive, note.id);
      if (open?.note.id === note.id) open = null;
      await refresh();
    });
  }
</script>

<section>
  <h2>Drive test panel <span class="tag">temporary</span></h2>
  <p class="status" role="status">{busy ? 'Working…' : status}</p>

  {#if folders}
    <div class="row">
      <label>
        Category
        <select
          bind:value={folderId}
          disabled={busy}
          onchange={() => run('Loaded', async () => refresh())}
        >
          {#each categories as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
        </select>
      </label>
      <button disabled={busy} onclick={createTestNote}>New test note</button>
      <button disabled={busy} onclick={() => run('Refreshed', refresh)}>Refresh</button>
    </div>

    {#if notes.length === 0}
      <p class="muted">No notes in this category.</p>
    {:else}
      <ul>
        {#each notes as note (note.id)}
          <li>
            <div class="title">
              <strong>{note.name}</strong>
              <span class="muted"
                >v{note.version} · {new Date(note.modifiedTime).toLocaleString()}</span
              >
            </div>
            <div class="row">
              <button disabled={busy} onclick={() => openNote(note)}>Open</button>
              <button disabled={busy} onclick={() => appendLine(note)}>Append line</button>
              <button disabled={busy} onclick={() => rename(note)}>Rename</button>
              <select
                aria-label="Move to category"
                disabled={busy || categories.length < 2}
                value=""
                onchange={(e) => move(note, e.currentTarget.value)}
              >
                <option value="" disabled>Move to…</option>
                {#each categories.filter((c) => c.id !== folderId) as c (c.id)}
                  <option value={c.id}>{c.name}</option>
                {/each}
              </select>
              <button disabled={busy} onclick={() => trash(note)}>Trash</button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}

    {#if open}
      <h3>{open.note.name}</h3>
      <pre>{open.text}</pre>
    {/if}

    <p class="muted">
      To test moving, create a second folder inside <code>Notes</code> in Google Drive, then press Refresh.
    </p>
  {/if}
</section>

<style>
  section {
    margin-top: 24px;
    padding-top: 16px;
    border-top: 1px solid var(--border);
  }

  h2 {
    margin: 0 0 8px;
    font-size: 1rem;
  }

  h3 {
    margin: 16px 0 8px;
    font-size: 1rem;
  }

  .tag {
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--warning-bg);
    font-size: 0.75rem;
    font-weight: 500;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  ul {
    margin: 16px 0 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 0;
    border-bottom: 1px solid var(--border);
  }

  .title {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    align-items: baseline;
  }

  button,
  select {
    min-height: 44px;
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-muted);
    color: var(--text);
    font: inherit;
  }

  button:disabled,
  select:disabled {
    opacity: 0.6;
  }

  label {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  pre {
    overflow-x: auto;
    padding: 12px;
    border-radius: 8px;
    background: var(--bg-muted);
    font-family: var(--font-mono);
    font-size: 0.875rem;
    white-space: pre-wrap;
  }

  .status {
    margin: 0 0 12px;
  }

  .muted {
    color: var(--text-muted);
  }

  code {
    font-family: var(--font-mono);
  }
</style>
