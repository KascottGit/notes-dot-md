<!-- A small dialog that asks for a name, e.g. for a new or renamed category. -->
<script lang="ts">
  interface Props {
    open: boolean;
    title: string;
    label: string;
    initial?: string;
    confirmLabel: string;
    /** Resolves to an error message to show, or null when done. */
    onSubmit: (name: string) => Promise<string | null>;
    onClose: () => void;
  }

  let { open, title, label, initial = '', confirmLabel, onSubmit, onClose }: Props = $props();

  let dialog = $state<HTMLDialogElement>();
  let input = $state<HTMLInputElement>();
  let value = $state('');
  let error = $state<string | null>(null);
  let busy = $state(false);

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      value = initial;
      error = null;
      dialog.showModal();
      input?.select();
    }
    if (!open && dialog.open) dialog.close();
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    try {
      error = await onSubmit(value);
      if (!error) onClose();
    } finally {
      busy = false;
    }
  }
</script>

<dialog bind:this={dialog} onclose={onClose} aria-labelledby="name-dialog-title">
  <form onsubmit={submit}>
    <h2 id="name-dialog-title">{title}</h2>
    <label>
      <span>{label}</span>
      <input bind:this={input} bind:value disabled={busy} autocomplete="off" />
    </label>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <div class="actions">
      <button type="button" class="secondary" disabled={busy} onclick={onClose}>Cancel</button>
      <button type="submit" class="primary" disabled={busy || !value.trim()}>{confirmLabel}</button>
    </div>
  </form>
</dialog>

<style>
  dialog {
    width: min(400px, calc(100vw - 32px));
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
    margin: 0 0 12px;
    font-size: 1.125rem;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  label span {
    color: var(--text-muted);
    font-size: 0.875rem;
  }

  input {
    min-height: 44px;
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 16px;
  }

  .error {
    margin: 8px 0 0;
    color: var(--danger);
    font-size: 0.875rem;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }

  button {
    min-height: 44px;
    padding: 0 16px;
    border-radius: 8px;
    font: inherit;
    cursor: pointer;
  }

  .secondary {
    border: 1px solid var(--border);
    background: var(--bg-muted);
    color: var(--text);
  }

  .primary {
    border: 0;
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
  }

  button:disabled {
    opacity: 0.6;
  }
</style>
