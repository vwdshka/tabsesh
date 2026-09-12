<script lang="ts">
  import { onMount } from 'svelte';
  import { fly, fade, slide } from 'svelte/transition';
  import {
    listSessions,
    stashAllWindows,
    createCategory,
    renameFolder,
    moveFolder,
    removeFolder,
    removeEntry,
    exportFolder,
    restoreFolder,
    listTrash,
    restoreFromTrash,
    undoLastDelete,
    searchStash,
    parseEntryTitle,
    startFocusSession,
    cancelFocusSession,
    getFocusSessionStatus,
    type FocusSessionStatus,
  } from '../core/bookmarks';
  import { formatBytes } from '../core/memory';
  import { getFaviconUrl } from '../core/favicon';
  import { shareFolder, GITHUB_TOKEN_SETUP_URL } from '../core/share';
  import { getKeepBrowserOpen, setKeepBrowserOpen, getGithubToken, setGithubToken } from '../core/storage';
  import type { FlatEntry, SearchMode, SessionFolder, TrashedFolder } from '../core/types';
  import Icon from './Icon.svelte';

  let root = $state<SessionFolder | null>(null);
  let loading = $state(true);
  let toast = $state<{ message: string; actionLabel?: string; onAction?: () => void } | null>(null);

  let showTrash = $state(false);
  let trashed = $state<TrashedFolder[]>([]);

  let stashCategory = $state('');
  let newCategory = $state('');
  let showNewCategory = $state(false);
  let busyId = $state<string | null>(null);
  let allExpanded = $state(false);
  let renamingId = $state<string | null>(null);
  let renameValue = $state('');
  let highlightedTitles = $state<Set<string>>(new Set());
  let openTabPreview = $state<{ url: string; title: string }[]>([]);
  let keepBrowserOpen = $state(true);

  let focusStatus = $state<FocusSessionStatus | null>(null);
  let focusStartId = $state<string | null>(null);
  let focusMinutes = $state(25);

  let showShareSettings = $state(false);
  let hasGithubToken = $state(false);
  let githubTokenInput = $state('');

  let query = $state('');
  let searchMode = $state<SearchMode>('all');
  let searchResults = $state<FlatEntry[] | null>(null);
  let searching = $state(false);

  const SEARCH_MODES: { value: SearchMode; label: string }[] = [
    { value: 'all', label: 'Everything' },
    { value: 'category', label: 'Category' },
    { value: 'link', label: 'Link' },
    { value: 'date', label: 'Date' },
  ];

  onMount(() => {
    refresh();
    loadOpenTabsPreview();
    getKeepBrowserOpen().then((v) => (keepBrowserOpen = v));
    getGithubToken().then((t) => (hasGithubToken = !!t));

    const onVisible = () => {
      if (!document.hidden) loadOpenTabsPreview();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    pollFocusStatus();
    const focusInterval = setInterval(pollFocusStatus, 1000);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      clearInterval(focusInterval);
    };
  });

  async function pollFocusStatus() {
    const next = await getFocusSessionStatus();
    const wasActive = focusStatus !== null;
    focusStatus = next;
    if (wasActive && next === null) {
      notify('Focus session ended — tabs re-stashed and closed.');
      await refresh();
    }
  }

  function formatCountdown(endsAt: number): string {
    const totalSeconds = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  async function refresh() {
    loading = true;
    try {
      root = await listSessions();
    } finally {
      loading = false;
    }
  }

  async function loadOpenTabsPreview() {
    const tabs = await browser.tabs.query({});
    openTabPreview = tabs
      .filter((t) => t.url && !t.url.startsWith('chrome-extension://'))
      .map((t) => ({ url: t.url!, title: t.title ?? t.url! }));
  }

  function flashFolder(title: string) {
    const next = new Set(highlightedTitles);
    next.add(title);
    highlightedTitles = next;
    setTimeout(() => {
      const after = new Set(highlightedTitles);
      after.delete(title);
      highlightedTitles = after;
    }, 1400);
  }

  async function handleKeepBrowserOpenChange(e: Event) {
    keepBrowserOpen = (e.target as HTMLInputElement).checked;
    await setKeepBrowserOpen(keepBrowserOpen);
  }

  function notify(message: string, action?: { label: string; onAction: () => void }) {
    const entry = { message, actionLabel: action?.label, onAction: action?.onAction };
    toast = entry;
    setTimeout(
      () => {
        if (toast === entry) toast = null;
      },
      action ? 8000 : 3500,
    );
  }

  async function refreshTrash() {
    trashed = await listTrash();
  }

  async function handleUndo() {
    try {
      const result = await undoLastDelete();
      if (!result) {
        notify('Nothing to undo.');
        return;
      }
      notify(
        result.titles.length > 1
          ? `Restored ${result.titles.length} folder(s): ${result.titles.join(', ')}.`
          : `Restored "${result.titles[0]}".`,
      );
      await refresh();
      result.titles.forEach(flashFolder);
      if (showTrash) await refreshTrash();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    }
  }

  async function toggleTrash() {
    showTrash = !showTrash;
    if (showTrash) await refreshTrash();
  }

  async function handleRestoreFromTrash(item: TrashedFolder) {
    try {
      const title = await restoreFromTrash(item.title);
      notify(`Restored "${title}" from trash.`);
      await refresh();
      flashFolder(title);
      await refreshTrash();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    }
  }

  function totalTabCount(folder: SessionFolder): number {
    return folder.entries.length + folder.children.reduce((sum, c) => sum + totalTabCount(c), 0);
  }

  function greeting(): string {
    const hour = new Date().getHours();
    if (hour < 5) return 'Still up?';
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  }

  async function handleStash() {
    try {
      const result = await stashAllWindows(stashCategory || undefined);
      stashCategory = '';

      const memoryNote = result.memoryFreedBytes ? ` — freed ~${formatBytes(result.memoryFreedBytes)} of memory` : '';
      let message = `Stashed ${result.tabCount} tab(s) into "${result.folder.title}"${memoryNote}.`;
      if (result.duplicates.length > 0) {
        const places = [...new Set(result.duplicates.flatMap((d) => d.existingIn))].join(', ');
        message += ` Note: ${result.duplicates.length} already saved in ${places}.`;
      }
      notify(message);
      await refresh();
      flashFolder(result.folder.title);
      await loadOpenTabsPreview();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleCreateCategory() {
    if (!newCategory.trim()) return;
    try {
      await createCategory(newCategory);
      notify(`Created category "${newCategory}".`);
      newCategory = '';
      showNewCategory = false;
      await refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleCopy(folder: SessionFolder) {
    busyId = folder.id;
    try {
      const result = await exportFolder(folder.title);
      if (result.urls.length === 0) {
        notify(`"${folder.title}" has no saved tabs.`);
      } else {
        await navigator.clipboard.writeText(result.markdown);
        notify(`Copied ${result.urls.length} URL(s) from "${folder.title}".`);
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    } finally {
      busyId = null;
    }
  }

  async function handleRestore(folder: SessionFolder) {
    busyId = folder.id;
    try {
      const result = await restoreFolder(folder.title);
      if (result.tabCount === 0) {
        notify(`"${folder.title}" has no saved tabs.`);
      } else {
        const extras = [
          result.groupCount ? `${result.groupCount} group(s)` : null,
          result.pinnedCount ? `${result.pinnedCount} pinned` : null,
        ].filter(Boolean);
        notify(
          `Restored "${folder.title}" — ${result.tabCount} tab(s) in this window${
            extras.length ? ` (${extras.join(', ')})` : ''
          }.`,
        );
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    } finally {
      busyId = null;
    }
  }

  function openFocusStart(folder: SessionFolder) {
    focusStartId = folder.id;
    focusMinutes = 25;
  }

  function cancelFocusStart() {
    focusStartId = null;
  }

  async function handleStartFocus(folder: SessionFolder) {
    busyId = folder.id;
    try {
      const status = await startFocusSession(folder.title, focusMinutes);
      focusStatus = status;
      focusStartId = null;
      notify(`Focus session started for "${status.folderTitle}" — ${focusMinutes} min.`);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    } finally {
      busyId = null;
    }
  }

  async function handleCancelFocus() {
    try {
      const title = await cancelFocusSession();
      focusStatus = null;
      if (title) notify(`Cancelled the focus session for "${title}". Its tabs are still open.`);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSaveGithubToken() {
    const trimmed = githubTokenInput.trim();
    await setGithubToken(trimmed || null);
    hasGithubToken = !!trimmed;
    githubTokenInput = '';
    showShareSettings = false;
    notify(hasGithubToken ? 'GitHub token saved.' : 'GitHub token cleared.');
  }

  async function handleShare(folder: SessionFolder) {
    if (!hasGithubToken) {
      showShareSettings = true;
      notify('Set a GitHub token first to enable sharing.');
      return;
    }
    busyId = folder.id;
    try {
      const url = await shareFolder(folder.title);
      await navigator.clipboard.writeText(url);
      notify(`Link copied to clipboard: ${url}`);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    } finally {
      busyId = null;
    }
  }

  async function handleRemove(folder: SessionFolder) {
    busyId = folder.id;
    try {
      await removeFolder(folder.title);
      notify(`Deleted "${folder.title}".`, { label: 'Undo', onAction: handleUndo });
      await refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    } finally {
      busyId = null;
    }
  }

  async function handleRemoveEntry(entry: { id: string; title: string }) {
    try {
      await removeEntry(entry.id);
      notify(`Removed "${parseEntryTitle(entry.title).label}".`);
      await refresh();
      await runSearch();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleMove(folder: SessionFolder, category: string) {
    if (!category) return;
    try {
      await moveFolder(folder.title, category);
      notify(`Moved "${folder.title}" into "${category}".`);
      await refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    }
  }

  function startRename(folder: SessionFolder) {
    renamingId = folder.id;
    renameValue = folder.title;
  }

  function cancelRename() {
    renamingId = null;
    renameValue = '';
  }

  async function commitRename(folder: SessionFolder) {
    const trimmed = renameValue.trim();
    if (renamingId !== folder.id) return;
    if (!trimmed || trimmed === folder.title) {
      cancelRename();
      return;
    }
    try {
      await renameFolder(folder.title, trimmed);
      notify(`Renamed "${folder.title}" to "${trimmed}".`);
      cancelRename();
      await refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    }
  }

  function focusOnMount(el: HTMLInputElement) {
    el.focus();
    el.select();
  }

  function toggleExpand() {
    allExpanded = !allExpanded;
  }

  function openTab(url: string) {
    browser.tabs.create({ url });
  }

  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleSearch() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 150);
  }

  async function runSearch() {
    if (!query.trim()) {
      searchResults = null;
      return;
    }
    searching = true;
    try {
      searchResults = await searchStash(query, searchMode);
    } finally {
      searching = false;
    }
  }

  $effect(() => {
    query;
    searchMode;
    scheduleSearch();
  });
</script>

<div class="flex h-full flex-col gap-5 overflow-y-auto p-4 sm:p-6">
  <header class="flex flex-wrap items-baseline justify-between gap-2">
    <div>
      <h1 class="text-lg font-medium text-ink">{greeting()}</h1>
      {#if root}
        <p class="text-xs text-ink-muted">
          {totalTabCount(root)} tab(s) tucked away across {root.children.length} folder(s).
        </p>
      {/if}
    </div>
    <div class="flex items-center gap-2">
      <button
        class="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-ink-muted transition-colors hover:border-accent hover:text-ink"
        onclick={() => (showShareSettings = !showShareSettings)}
        aria-expanded={showShareSettings}
      >
        <Icon name="key" />
        Share settings
      </button>
      <button
        class="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-ink-muted transition-colors hover:border-accent hover:text-ink"
        onclick={toggleTrash}
        aria-expanded={showTrash}
      >
        <Icon name="trash" />
        Trash
      </button>
    </div>
  </header>

  {#if focusStatus}
    <section
      class="flex items-center justify-between gap-3 rounded-2xl border border-accent/40 bg-surface-raised p-4 shadow-sm"
      transition:slide={{ duration: 150 }}
    >
      <div class="flex items-center gap-2">
        <Icon name="clock" class="shrink-0 text-accent" />
        <p class="text-sm text-ink">
          Focus session: <span class="font-medium">{focusStatus.folderTitle}</span>
          — <span class="tabular-nums text-accent">{formatCountdown(focusStatus.endsAt)}</span> left
        </p>
      </div>
      <button
        class="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-xs text-ink-muted transition-colors hover:border-red-400 hover:text-red-400"
        onclick={handleCancelFocus}
      >
        Cancel
      </button>
    </section>
  {/if}

  {#if showShareSettings}
    <section
      class="flex flex-col gap-2 rounded-2xl border border-border bg-surface-raised p-4 shadow-sm"
      transition:slide={{ duration: 150 }}
    >
      <h2 class="text-sm font-medium text-ink">Share settings</h2>
      <p class="text-xs text-ink-muted">
        Sharing publishes a folder's links as a public GitHub Gist. This needs a personal access
        token with just the <code class="rounded bg-surface-inset px-1 py-0.5">gist</code> scope — it's
        stored only on this device and sent only to GitHub, directly from your browser.
      </p>
      <a
        href={GITHUB_TOKEN_SETUP_URL}
        target="_blank"
        rel="noreferrer"
        class="text-xs text-accent underline decoration-dotted underline-offset-2"
      >
        Create a token on GitHub ↗
      </a>
      <div class="flex items-center gap-2 pt-1">
        <input
          type="password"
          bind:value={githubTokenInput}
          placeholder={hasGithubToken ? 'Token saved — paste a new one to replace it' : 'Paste your token here'}
          class="min-w-0 flex-1 rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
          aria-label="GitHub personal access token"
          onkeydown={(e) => e.key === 'Enter' && handleSaveGithubToken()}
        />
        <button
          class="shrink-0 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-surface-inset transition-opacity hover:opacity-90"
          onclick={handleSaveGithubToken}
        >
          Save
        </button>
      </div>
      {#if hasGithubToken}
        <p class="text-xs text-ink-muted">A token is currently saved. Sharing is enabled.</p>
      {/if}
    </section>
  {/if}

  {#if showTrash}
    <section
      class="flex flex-col gap-2 rounded-2xl border border-border bg-surface-raised p-4 shadow-sm"
      transition:slide={{ duration: 150 }}
    >
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-medium text-ink">Trash</h2>
        <p class="text-xs text-ink-muted">Deleted folders stick around here for 48 hours before they're gone for good.</p>
      </div>
      {#if trashed.length === 0}
        <p class="text-sm text-ink-muted">Trash is empty.</p>
      {:else}
        <ul class="flex flex-col gap-2">
          {#each trashed as item (item.id)}
            {@const hoursLeft = Math.max(0, Math.round((item.expiresAt - Date.now()) / (60 * 60 * 1000)))}
            <li class="flex items-center gap-3 rounded-xl border border-border bg-surface-inset p-3" transition:slide={{ duration: 120 }}>
              <Icon name="folder" class="shrink-0 text-ink-muted" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm text-ink">{item.title}</p>
                <p class="text-xs text-ink-muted">{item.tabCount} tab(s) · gone for good in ~{hoursLeft}h</p>
              </div>
              <button
                class="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-xs text-ink-muted transition-colors hover:border-accent hover:text-ink"
                onclick={() => handleRestoreFromTrash(item)}
              >
                Restore
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}

  <section class="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface-raised p-4 shadow-sm">
    <input
      bind:value={stashCategory}
      placeholder="Category (optional — defaults to date/time)"
      class="min-w-56 flex-1 rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
      aria-label="Stash category name"
      onkeydown={(e) => e.key === 'Enter' && handleStash()}
    />
    <button
      class="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-surface-inset transition-all hover:opacity-90 active:scale-95"
      onclick={handleStash}
    >
      <Icon name="inbox" />
      Stash all windows
    </button>

    {#if showNewCategory}
      <div class="flex items-center gap-2" transition:fly={{ x: -8, duration: 150 }}>
        <input
          bind:value={newCategory}
          placeholder="New category name"
          class="rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
          aria-label="New category name"
          onkeydown={(e) => e.key === 'Enter' && handleCreateCategory()}
        />
        <button
          class="rounded-lg border border-border px-3 py-2 text-sm text-ink-muted transition-colors hover:border-accent hover:text-ink"
          onclick={handleCreateCategory}
        >
          Create
        </button>
      </div>
    {:else}
      <button
        class="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-ink-muted transition-colors hover:border-accent hover:text-ink"
        onclick={() => (showNewCategory = true)}
      >
        <Icon name="plus" />
        New category
      </button>
    {/if}

    {#if openTabPreview.length > 0}
      <div class="flex w-full items-center gap-2 text-xs text-ink-muted" transition:fade={{ duration: 150 }}>
        <span class="shrink-0">About to stash {openTabPreview.length} tab(s):</span>
        <div class="flex -space-x-1.5">
          {#each openTabPreview.slice(0, 12) as tab, i (i)}
            <img
              src={getFaviconUrl(tab.url)}
              alt=""
              title={tab.title}
              class="h-4 w-4 rounded-full ring-2 ring-surface-raised"
              onerror={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')}
            />
          {/each}
        </div>
        {#if openTabPreview.length > 12}
          <span class="shrink-0">+{openTabPreview.length - 12} more</span>
        {/if}
      </div>
    {/if}

    <label class="flex w-full items-center gap-2 text-xs text-ink-muted">
      <input type="checkbox" checked={keepBrowserOpen} onchange={handleKeepBrowserOpenChange} class="accent-accent" />
      Keep browser open if stashing would close every tab
    </label>
  </section>

  <section class="flex flex-col gap-2 rounded-2xl border border-border bg-surface-raised p-3 shadow-sm sm:flex-row sm:items-center">
    <div class="relative flex-1">
      <Icon name="search" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
      <input
        bind:value={query}
        placeholder="Search by category, link title/URL, or date…"
        class="w-full rounded-lg border border-border bg-surface-inset py-2 pl-9 pr-3 text-sm text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
        aria-label="Search stashed tabs"
      />
    </div>
    <div class="flex gap-1 overflow-x-auto" role="radiogroup" aria-label="Search by">
      {#each SEARCH_MODES as m (m.value)}
        <button
          class={`whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
            searchMode === m.value
              ? 'bg-accent text-surface-inset'
              : 'border border-border text-ink-muted hover:border-accent hover:text-ink'
          }`}
          role="radio"
          aria-checked={searchMode === m.value}
          onclick={() => (searchMode = m.value)}
        >
          {m.label}
        </button>
      {/each}
    </div>
  </section>

  {#if toast}
    <div
      class="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-raised px-4 py-2 text-xs text-ink-muted shadow-sm"
      role="status"
      transition:fade={{ duration: 150 }}
    >
      <span>{toast.message}</span>
      {#if toast.onAction}
        <button
          class="shrink-0 font-medium text-accent transition-opacity hover:opacity-80"
          onclick={() => {
            toast?.onAction?.();
            toast = null;
          }}
        >
          {toast.actionLabel}
        </button>
      {/if}
    </div>
  {/if}

  {#if searchResults !== null}
    <section class="flex flex-col gap-2" transition:fade={{ duration: 120 }}>
      <p class="text-xs text-ink-muted">
        {searching ? 'Searching…' : `${searchResults.length} result(s) for "${query}"`}
      </p>
      <ul class="flex flex-col gap-2">
        {#each searchResults as entry (entry.id)}
          {@const parsed = parseEntryTitle(entry.title)}
          <li
            class="flex items-center gap-3 rounded-xl border border-border bg-surface-raised p-3 shadow-sm"
            transition:slide={{ duration: 120 }}
          >
            <img
              src={getFaviconUrl(entry.url)}
              alt=""
              class="h-4 w-4 shrink-0 rounded-sm"
              onerror={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')}
            />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm text-ink">{parsed.label}</p>
              <p class="truncate text-xs text-ink-muted">
                {entry.folderPath.join(' / ') || 'TabSesh'}{parsed.timestamp ? ` · ${parsed.timestamp}` : ''}
              </p>
            </div>
            <button
              class="shrink-0 rounded-lg border border-border p-1.5 text-ink-muted transition-colors hover:border-accent hover:text-ink"
              onclick={() => openTab(entry.url)}
              aria-label={`Open ${parsed.label}`}
            >
              <Icon name="external-link" />
            </button>
            <button
              class="shrink-0 rounded-lg border border-border p-1.5 text-ink-muted transition-colors hover:border-red-400 hover:text-red-400"
              onclick={() => handleRemoveEntry(entry)}
              aria-label={`Delete ${parsed.label}`}
            >
              <Icon name="trash" />
            </button>
          </li>
        {:else}
          <p class="text-sm text-ink-muted">Nothing matches yet — try a different search mode.</p>
        {/each}
      </ul>
    </section>
  {:else if loading}
    <p class="text-sm text-ink-muted">Loading…</p>
  {:else if root && root.children.length > 0}
    <ul class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {#each root.children as folder (folder.id)}
        <li
          class={`group flex flex-col gap-3 rounded-2xl border border-border bg-surface-raised p-4 shadow-sm transition-shadow hover:shadow-md ${
            highlightedTitles.has(folder.title) ? 'flash-highlight' : ''
          }`}
          transition:fly={{ y: 8, duration: 180 }}
        >
          <div class="flex items-start justify-between gap-2">
            <div class="flex min-w-0 flex-1 items-start gap-2">
              <Icon name="folder" class="mt-0.5 shrink-0 text-ink-muted" />
              <div class="min-w-0 flex-1">
                {#if renamingId === folder.id}
                  <input
                    use:focusOnMount
                    bind:value={renameValue}
                    class="w-full rounded border border-accent bg-surface-inset px-1.5 py-0.5 text-sm text-ink outline-none"
                    aria-label={`Rename ${folder.title}`}
                    onkeydown={(e) => {
                      if (e.key === 'Enter') commitRename(folder);
                      else if (e.key === 'Escape') cancelRename();
                    }}
                    onblur={() => commitRename(folder)}
                  />
                {:else}
                  <div class="flex items-center gap-1">
                    <h2 class="truncate text-sm font-medium text-ink">{folder.title}</h2>
                    <button
                      class="shrink-0 rounded p-0.5 text-ink-muted opacity-0 transition-opacity hover:text-ink group-hover:opacity-100 focus-visible:opacity-100"
                      onclick={() => startRename(folder)}
                      aria-label={`Rename ${folder.title}`}
                    >
                      <Icon name="edit" />
                    </button>
                  </div>
                {/if}
                <p class="text-xs text-ink-muted">{totalTabCount(folder)} tab(s)</p>
              </div>
            </div>
            <button
              class="shrink-0 rounded p-1 text-ink-muted transition-colors hover:text-ink"
              onclick={toggleExpand}
              aria-expanded={allExpanded}
              title="Expand/collapse all folders"
              aria-label={`${allExpanded ? 'Collapse' : 'Expand'} all folders`}
            >
              <Icon name="chevron-down" class={`transition-transform ${allExpanded ? 'rotate-180' : ''}`} />
            </button>
          </div>

          {#if allExpanded}
            <ul class="flex flex-col gap-1.5 border-l border-border pl-3" transition:slide={{ duration: 150 }}>
              {#each folder.entries as entry (entry.id)}
                {@const parsed = parseEntryTitle(entry.title)}
                <li class="flex items-center gap-2">
                  <img
                    src={getFaviconUrl(entry.url)}
                    alt=""
                    class="h-3.5 w-3.5 shrink-0 rounded-sm"
                    onerror={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')}
                  />
                  <span class="min-w-0 flex-1 truncate text-xs text-ink" title={entry.url}>{parsed.label}</span>
                  <button
                    class="shrink-0 rounded p-1 text-ink-muted transition-colors hover:text-ink"
                    onclick={() => openTab(entry.url)}
                    aria-label={`Open ${parsed.label}`}
                  >
                    <Icon name="external-link" />
                  </button>
                  <button
                    class="shrink-0 rounded p-1 text-ink-muted transition-colors hover:text-red-400"
                    onclick={() => handleRemoveEntry(entry)}
                    aria-label={`Delete ${parsed.label}`}
                  >
                    <Icon name="trash" />
                  </button>
                </li>
              {/each}
              {#each folder.children as sub (sub.id)}
                <li class="text-xs text-ink-muted">↳ {sub.title} ({totalTabCount(sub)})</li>
              {/each}
            </ul>
          {/if}

          {#if focusStartId === folder.id}
            <div class="flex items-center gap-2 pt-1" transition:slide={{ duration: 120 }}>
              <Icon name="clock" class="shrink-0 text-ink-muted" />
              <input
                use:focusOnMount
                type="number"
                min="1"
                bind:value={focusMinutes}
                class="w-16 rounded-lg border border-border bg-surface-inset px-2 py-1 text-xs text-ink focus:border-accent focus:outline-none"
                aria-label="Focus session length in minutes"
                onkeydown={(e) => e.key === 'Enter' && handleStartFocus(folder)}
              />
              <span class="text-xs text-ink-muted">min</span>
              <button
                class="rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-surface-inset transition-opacity hover:opacity-90"
                onclick={() => handleStartFocus(folder)}
              >
                Start
              </button>
              <button
                class="rounded-lg border border-border px-2.5 py-1 text-xs text-ink-muted transition-colors hover:text-ink"
                onclick={cancelFocusStart}
              >
                ✕
              </button>
            </div>
          {/if}

          <div class="mt-auto flex flex-wrap items-center gap-2 pt-1">
            <button
              class="flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-surface-inset transition-all hover:opacity-90 active:scale-95 disabled:opacity-40"
              onclick={() => handleRestore(folder)}
              disabled={busyId === folder.id}
              aria-label={`Restore ${folder.title} as a window`}
            >
              <Icon name="window" />
              Restore
            </button>

            <button
              class="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-ink-muted transition-all hover:border-accent hover:text-ink active:scale-95 disabled:opacity-40"
              onclick={() => handleCopy(folder)}
              disabled={busyId === folder.id}
              aria-label={`Copy URLs from ${folder.title}`}
            >
              <Icon name="copy" />
              Copy
            </button>

            <button
              class="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-ink-muted transition-all hover:border-accent hover:text-ink active:scale-95 disabled:opacity-40"
              onclick={() => openFocusStart(folder)}
              disabled={busyId === folder.id || (focusStatus !== null && focusStatus.folderTitle !== folder.title)}
              title={focusStatus !== null && focusStatus.folderTitle !== folder.title ? 'A focus session is already running' : ''}
              aria-label={`Start a focus session for ${folder.title}`}
            >
              <Icon name="clock" />
              Focus
            </button>

            <button
              class="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-ink-muted transition-all hover:border-accent hover:text-ink active:scale-95 disabled:opacity-40"
              onclick={() => handleShare(folder)}
              disabled={busyId === folder.id}
              aria-label={`Share ${folder.title} as a public link`}
            >
              <Icon name="share" />
              Share
            </button>

            {#if root.children.length > 1}
              <div class="relative flex items-center">
                <Icon name="move" class="pointer-events-none absolute left-2 text-ink-muted" />
                <select
                  class="appearance-none rounded-lg border border-border bg-surface-inset py-1.5 pl-7 pr-2 text-xs text-ink-muted focus:border-accent focus:outline-none"
                  aria-label={`Move ${folder.title} into category`}
                  onchange={(e) => handleMove(folder, (e.target as HTMLSelectElement).value)}
                >
                  <option value="">Move to…</option>
                  {#each root.children.filter((c) => c.id !== folder.id) as target (target.id)}
                    <option value={target.title}>{target.title}</option>
                  {/each}
                </select>
              </div>
            {/if}

            <button
              class="ml-auto flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-ink-muted transition-all hover:border-red-400 hover:text-red-400 active:scale-95 disabled:opacity-40"
              onclick={() => handleRemove(folder)}
              disabled={busyId === folder.id}
              aria-label={`Delete ${folder.title}`}
            >
              <Icon name="trash" />
              Delete
            </button>
          </div>
        </li>
      {/each}
    </ul>
  {:else}
    <div class="flex flex-1 flex-col items-center justify-center gap-2 py-12 text-center">
      <Icon name="sparkle" class="text-ink-muted" />
      <p class="text-sm text-ink-muted">Nothing stashed yet.</p>
      <p class="text-xs text-ink-muted">Open a few tabs, then hit "Stash all windows" above to tuck them away.</p>
    </div>
  {/if}
</div>

<style>
  @keyframes pulse-glow {
    0% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-accent) 55%, transparent);
    }
    100% {
      box-shadow: 0 0 0 10px color-mix(in srgb, var(--color-accent) 0%, transparent);
    }
  }
  .flash-highlight {
    animation: pulse-glow 1.2s ease-out;
  }
</style>
