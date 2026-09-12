<script lang="ts">
  import Terminal from '../../lib/tui/Terminal.svelte';

  function closeOverlay() {
    window.parent.postMessage({ type: 'tabsesh-overlay-close' }, '*');
  }

  function openFullApp() {
    browser.tabs.create({ url: browser.runtime.getURL('/app.html') });
    closeOverlay();
  }
</script>

<div class="flex h-screen w-screen flex-col bg-surface text-ink">
  <header class="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
    <div class="flex items-center gap-1.5 text-xs text-ink-muted">
      <span>TabSesh quick overlay</span>
      <span class="text-ink-muted/70">— Esc to close</span>
    </div>
    <div class="flex items-center gap-1">
      <button
        class="rounded px-2 py-1 text-xs text-ink-muted transition-colors hover:text-ink"
        onclick={openFullApp}
      >
        Open full app ⤢
      </button>
      <button
        class="rounded p-1 text-ink-muted transition-colors hover:text-ink"
        onclick={closeOverlay}
        aria-label="Close overlay"
      >
        ✕
      </button>
    </div>
  </header>
  <div class="min-h-0 flex-1">
    <Terminal onRequestClose={closeOverlay} compact />
  </div>
</div>
