<script lang="ts">
  import { onMount } from 'svelte';
  import { stashAllWindows, listSessions, restoreFolder } from '../../lib/core/bookmarks';
  import { formatBytes } from '../../lib/core/memory';
  import { getTerminalColor, DEFAULT_TERMINAL_COLOR } from '../../lib/core/storage';
  import type { SessionFolder } from '../../lib/core/types';
  import Icon from '../../lib/gui/Icon.svelte';

  let status = $state<string | null>(null);
  let busy = $state(false);
  let loadingStats = $state(true);
  let totalTabs = $state(0);
  let totalFolders = $state(0);
  let lastFolder = $state<SessionFolder | null>(null);
  let accentColor = $state(DEFAULT_TERMINAL_COLOR);

  function greeting(): string {
    const hour = new Date().getHours();
    if (hour < 5) return 'Still up?';
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  }

  function totalTabCount(folder: SessionFolder): number {
    return folder.entries.length + folder.children.reduce((sum, c) => sum + totalTabCount(c), 0);
  }

  async function loadStats() {
    loadingStats = true;
    try {
      const root = await listSessions();
      totalTabs = totalTabCount(root);
      totalFolders = root.children.length;
      lastFolder = [...root.children].sort((a, b) => b.dateAdded - a.dateAdded)[0] ?? null;
    } finally {
      loadingStats = false;
    }
  }

  onMount(async () => {
    accentColor = await getTerminalColor();
    await loadStats();
  });

  async function handleStash() {
    busy = true;
    status = null;
    try {
      const result = await stashAllWindows();
      const memoryNote = result.memoryFreedBytes ? ` — freed ~${formatBytes(result.memoryFreedBytes)}` : '';
      status = `Stashed ${result.tabCount} tab(s) into "${result.folder.title}"${memoryNote}.`;
      await loadStats();
    } catch (err) {
      status = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  async function handleRestoreLast() {
    if (!lastFolder) return;
    busy = true;
    status = null;
    try {
      const result = await restoreFolder(lastFolder.title);
      status = `Restored "${result.folderTitle}" — ${result.tabCount} tab(s) in this window.`;
      await loadStats();
    } catch (err) {
      status = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  function openFullApp() {
    browser.tabs.create({ url: browser.runtime.getURL('/app.html') });
  }
</script>

<main class="flex w-72 flex-col gap-3 bg-surface p-4 text-ink" style={`--color-accent: ${accentColor}`}>
  <header class="flex items-center gap-2 border-b border-border pb-3">
    <div>
      <h1 class="text-sm font-medium tracking-wide text-ink">TabSesh</h1>
      <p class="text-xs text-ink-muted">{greeting()}</p>
    </div>
  </header>

  {#if !loadingStats && totalFolders > 0}
    <p class="text-xs text-ink-muted">{totalTabs} tab(s) tucked away across {totalFolders} folder(s).</p>
  {/if}

  <button
    class="flex items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2.5 text-sm font-medium text-surface-inset transition-opacity hover:opacity-90 disabled:opacity-50"
    onclick={handleStash}
    disabled={busy}
  >
    <Icon name="inbox" class="shrink-0" />
    {busy ? 'Stashing…' : 'Stash all windows'}
  </button>

  {#if lastFolder}
    <button
      class="flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2 text-left text-sm text-ink transition-colors hover:border-accent disabled:opacity-50"
      onclick={handleRestoreLast}
      disabled={busy}
    >
      <Icon name="window" class="shrink-0" />
      <span class="min-w-0 flex-1 truncate">Restore "{lastFolder.title}"</span>
    </button>
  {/if}

  <button
    class="flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2 text-left text-sm text-ink transition-colors hover:border-accent"
    onclick={openFullApp}
  >
    <Icon name="external-link" class="shrink-0" />
    Open full app
  </button>

  {#if status}
    <p class="rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs leading-snug text-ink-muted" role="status">
      {status}
    </p>
  {/if}
</main>
