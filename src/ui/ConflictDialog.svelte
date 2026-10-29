<script lang="ts">
  import type { ConflictChoice } from '../store/noteSession';

  interface Props {
    open: boolean;
    title: string;
    onChoose: (choice: ConflictChoice) => Promise<void>;
  }

  let { open, title, onChoose }: Props = $props();

  let dialog = $state<HTMLDialogElement>();
  let busy = $state(false);

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });

  async function choose(choice: ConflictChoice) {
    busy = true;
    try {
      await onChoose(choice);
    } finally {
      busy = false;
    }
  }
</script>

<!-- Escape would close the dialog without a choice; keep it open until one is made. -->
<dialog bind:this={dialog} oncancel={(e) => e.preventDefault()} aria-labelledby="conflict-title">
  <h2 id="conflict-title">This note changed on another device</h2>
  <p>
    "{title}" was saved somewhere else after you opened it. Your changes have not been saved yet.
    What should happen?
  </p>
  <div class="choices">
    <button disabled={busy} onclick={() => choose('theirs')}>
      <strong>Load theirs</strong>
      <span>Show the other version. Your changes are discarded (Ctrl+Z brings them back).</span>
    </button>
    <button disabled={busy} onclick={() => choose('mine')}>
      <strong>Keep mine</strong>
      <span>Overwrite the other version with yours.</span>
    </button>
    <button disabled={busy} onclick={() => choose('copy')}>
      <strong>Save mine as a copy</strong>
      <span>Keep both: yours goes in a new note, this one shows theirs.</span>
    </button>
  </div>
</dialog>

<style>
  dialog {
    width: min(480px, calc(100vw - 32px));
    padding: 20px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--bg);
    color: var(--text);
  }

  dialog::backdrop {
    background: rgb(0 0 0 / 40%);
  }

  h2 {
    margin: 0 0 8px;
    font-size: 1.125rem;
  }

  p {
    margin: 0 0 16px;
    color: var(--text-muted);
  }

  .choices {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  button {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-height: 44px;
    padding: 10px 14px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-muted);
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.6;
  }

  button span {
    color: var(--text-muted);
    font-size: 0.875rem;
  }
</style>
