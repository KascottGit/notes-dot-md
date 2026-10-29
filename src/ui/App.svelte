<script lang="ts">
  const devLabel = import.meta.env.DEV ? ' (dev)' : '';
</script>

<div class="shell">
  <header>
    <h1>notes.md{devLabel}</h1>
  </header>
  <main>
    <p>Markdown notes stored as plain <code>.md</code> files in your Google Drive.</p>
    <p class="muted">App shell only. Sign-in comes in the next milestone.</p>
  </main>
</div>

<style>
  .shell {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  header {
    display: flex;
    align-items: center;
    min-height: 56px;
    padding: 0 16px;
    border-bottom: 1px solid var(--border);
  }

  h1 {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 600;
  }

  main {
    flex: 1;
    padding: 24px 16px;
    max-width: 720px;
  }

  code {
    font-family: var(--font-mono);
    background: var(--bg-muted);
    padding: 0.1em 0.3em;
    border-radius: 4px;
  }

  .muted {
    color: var(--text-muted);
  }
</style>
