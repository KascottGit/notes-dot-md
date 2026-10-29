<!-- A short message at the bottom of the screen, with an optional action like Undo. -->
<script lang="ts">
  interface Props {
    message: string;
    actionLabel?: string;
    onAction?: () => void;
    onClose: () => void;
    /** Milliseconds before it hides by itself. */
    duration?: number;
  }

  let { message, actionLabel, onAction, onClose, duration = 6000 }: Props = $props();

  $effect(() => {
    void message; // Restart the timer when the message changes.
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  });
</script>

<div class="toast" role="status" aria-live="polite">
  <span>{message}</span>
  {#if actionLabel && onAction}
    <button
      onclick={() => {
        onAction();
        onClose();
      }}>{actionLabel}</button
    >
  {/if}
</div>

<style>
  .toast {
    position: fixed;
    bottom: calc(16px + env(safe-area-inset-bottom));
    left: 50%;
    z-index: 30;
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: calc(100vw - 32px);
    padding: 4px 4px 4px 16px;
    border-radius: 10px;
    background: var(--text);
    color: var(--bg);
    box-shadow: 0 6px 24px rgb(0 0 0 / 25%);
    transform: translateX(-50%);
  }

  span {
    overflow: hidden;
    padding: 10px 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  button {
    flex: none;
    min-height: 44px;
    padding: 0 12px;
    border: 0;
    border-radius: 8px;
    background: none;
    color: var(--bg);
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }
</style>
