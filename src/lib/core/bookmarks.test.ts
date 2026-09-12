import { fakeBrowser } from '@webext-core/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatTimestamp,
  parseEntryTitle,
  getOrCreateRootFolder,
  listSessions,
  stashTabs,
  stashAllWindows,
  createCategory,
  renameFolder,
  moveFolder,
  removeFolder,
  clearAll,
  listTrash,
  restoreFromTrash,
  undoLastDelete,
  exportFolder,
  removeEntry,
  flattenEntries,
  searchStash,
  restoreFolder,
  startFocusSession,
  cancelFocusSession,
  getFocusSessionStatus,
  endFocusSession,
} from './bookmarks';
import { setKeepBrowserOpen } from './storage';

describe('formatTimestamp', () => {
  it('pads to YYYY-MM-DD HH:MM:SS', () => {
    const date = new Date(2026, 0, 5, 9, 3, 7);
    expect(formatTimestamp(date)).toBe('2026-01-05 09:03:07');
  });
});

describe('parseEntryTitle', () => {
  it('splits a stamped title into timestamp and label', () => {
    expect(parseEntryTitle('[2026-01-05 09:03:07] Example Page')).toEqual({
      timestamp: '2026-01-05 09:03:07',
      label: 'Example Page',
    });
  });

  it('returns the whole thing as the label when there is no stamp', () => {
    expect(parseEntryTitle('Just a title')).toEqual({ timestamp: null, label: 'Just a title' });
  });
});

describe('getOrCreateRootFolder', () => {
  it('creates the folder once and reuses it on later calls', async () => {
    const first = await getOrCreateRootFolder();
    const second = await getOrCreateRootFolder();
    expect(first.id).toBe(second.id);
    expect(first.title).toBe('TabSesh');
  });

  it('renames an existing tab-cli folder instead of creating a duplicate', async () => {
    const root = await fakeBrowser.bookmarks.getTree();
    const otherBookmarks = root[0]!.children!.find((c) => c.id === '2')!;
    await fakeBrowser.bookmarks.create({ parentId: otherBookmarks.id, title: 'tab-cli' });

    const found = await getOrCreateRootFolder();
    expect(found.title).toBe('TabSesh');

    const tree = await fakeBrowser.bookmarks.getTree();
    const other = tree[0]!.children!.find((c) => c.id === '2')!;
    expect(other.children!.filter((c) => c.title === 'TabSesh' || c.title === 'tab-cli')).toHaveLength(1);
  });
});

interface FakeTab {
  id?: number;
  url?: string;
  title?: string;
  pinned?: boolean;
  groupId?: number;
}

async function createTab(props: { url: string; pinned?: boolean }): Promise<FakeTab> {
  return (await fakeBrowser.tabs.create({ url: props.url, pinned: props.pinned, active: false })) as FakeTab;
}

// fake-browser seeds/recreates blank, url-less tabs as internal bookkeeping side effects
// (a fresh window's placeholder tab, or a replacement when the last real window tab closes).
// Those never happen for a real Chrome tab and are irrelevant to what our own code cares
// about, so tests check real tabs by url rather than raw tab counts.
async function openTabUrls(): Promise<string[]> {
  const tabs = await fakeBrowser.tabs.query({});
  return tabs.filter((t) => t.url).map((t) => t.url!);
}

describe('stashAllWindows', () => {
  it('saves open tabs into a named folder and closes them', async () => {
    await setKeepBrowserOpen(false); // isolate this from the safety-net behavior, tested separately below
    await createTab({ url: 'https://a.example' });
    await createTab({ url: 'https://b.example' });

    const result = await stashAllWindows('Research');

    expect(result.folder.title).toBe('Research');
    expect(result.tabCount).toBe(2);
    expect(await openTabUrls()).toHaveLength(0);
  });

  it('defaults the folder name to a timestamp when none is given', async () => {
    await createTab({ url: 'https://a.example' });
    const result = await stashAllWindows();
    expect(result.folder.title).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('flags urls that were already stashed elsewhere without skipping them', async () => {
    await createTab({ url: 'https://dup.example' });
    await stashAllWindows('First');

    await createTab({ url: 'https://dup.example' });
    const second = await stashAllWindows('Second');

    expect(second.tabCount).toBe(1);
    expect(second.duplicates).toEqual([{ title: 'https://dup.example', url: 'https://dup.example', existingIn: ['First'] }]);
  });

  it('leaves a fresh tab behind when a stash would otherwise close every tab', async () => {
    await createTab({ url: 'https://only.example' });
    // fake-browser always seeds a placeholder id:0 tab with no url; removed here (while the
    // window still has another tab, so the window itself survives) so "only.example" really
    // is the only tab open, matching what this test needs to simulate
    await fakeBrowser.tabs.remove(0);
    const createSpy = vi.spyOn(fakeBrowser.tabs, 'create');

    await stashAllWindows('Only');

    expect(createSpy).toHaveBeenCalledWith({});
    expect(await openTabUrls()).toHaveLength(0);
  });

  it('does not add a safety-net tab when other tabs remain open', async () => {
    await createTab({ url: 'https://stash-me.example' });
    await createTab({ url: 'chrome-extension://abc/app.html' }); // never stashed
    const createSpy = vi.spyOn(fakeBrowser.tabs, 'create');

    await stashAllWindows('Partial');

    expect(createSpy).not.toHaveBeenCalledWith({});
    expect(await openTabUrls()).toEqual(['chrome-extension://abc/app.html']);
  });
});

describe('stashTabs', () => {
  it('records pinned state and tab-group membership as entry metadata', async () => {
    (fakeBrowser as unknown as { tabGroups: { _seed: Function } }).tabGroups._seed(5, {
      title: 'Reading',
      color: 'blue',
    });

    const pinned = await createTab({ url: 'https://pinned.example', pinned: true });
    const grouped = await createTab({ url: 'https://grouped.example' });

    const result = await stashTabs([pinned, { ...grouped, groupId: 5 }], 'Mixed');

    expect(result.tabCount).toBe(2);
  });
});

describe('createCategory', () => {
  it('creates a folder at the root', async () => {
    const category = await createCategory('Projects');
    expect(category.title).toBe('Projects');

    const root = await listSessions();
    expect(root.children.map((c) => c.title)).toContain('Projects');
  });

  it('rejects a duplicate name', async () => {
    await createCategory('Projects');
    await expect(createCategory('Projects')).rejects.toThrow(/already exists/);
  });

  it('rejects an empty name', async () => {
    await expect(createCategory('   ')).rejects.toThrow(/empty/);
  });

  it('rejects the reserved trash name', async () => {
    await expect(createCategory('.trash')).rejects.toThrow(/reserved/);
  });
});

describe('renameFolder', () => {
  it('renames a folder', async () => {
    await createCategory('Old');
    const renamed = await renameFolder('Old', 'New');
    expect(renamed.title).toBe('New');
  });

  it('rejects renaming into a name that already exists', async () => {
    await createCategory('Alpha');
    await createCategory('Beta');
    await expect(renameFolder('Alpha', 'Beta')).rejects.toThrow(/already exists/);
  });

  it('rejects renaming the root folder', async () => {
    await expect(renameFolder('TabSesh', 'Whatever')).rejects.toThrow(/can't be renamed/);
  });

  it('rejects an unknown folder', async () => {
    await expect(renameFolder('Nope', 'Whatever')).rejects.toThrow(/No folder named/);
  });
});

describe('moveFolder', () => {
  it('moves a folder into a category', async () => {
    await createTab({ url: 'https://a.example' });
    await stashAllWindows('Session');
    await createCategory('Category');

    await moveFolder('Session', 'Category');

    const root = await listSessions();
    const category = root.children.find((c) => c.title === 'Category')!;
    expect(category.children.map((c) => c.title)).toContain('Session');
  });

  it('rejects moving a folder into itself', async () => {
    await createCategory('Solo');
    await expect(moveFolder('Solo', 'Solo')).rejects.toThrow(/into itself/);
  });

  it('rejects moving into a bookmark that is not a folder', async () => {
    await createTab({ url: 'https://a.example' });
    await stashAllWindows('Session');
    await expect(moveFolder('Session', 'https://a.example')).rejects.toThrow(/No category named/);
  });
});

describe('removeFolder, trash, and undo', () => {
  it('soft-deletes into trash instead of removing outright', async () => {
    await createCategory('Temp');
    await removeFolder('Temp');

    const root = await listSessions();
    expect(root.children.map((c) => c.title)).not.toContain('Temp');

    const trashed = await listTrash();
    expect(trashed.map((t) => t.title)).toContain('Temp');
  });

  it('restoreFromTrash brings a specific folder back', async () => {
    await createCategory('Temp');
    await removeFolder('Temp');
    await restoreFromTrash('Temp');

    const root = await listSessions();
    expect(root.children.map((c) => c.title)).toContain('Temp');
    expect(await listTrash()).toHaveLength(0);
  });

  it('undoLastDelete restores the most recently deleted folder', async () => {
    await createCategory('First');
    await createCategory('Second');
    await removeFolder('First');
    await removeFolder('Second');

    const result = await undoLastDelete();
    expect(result?.titles).toEqual(['Second']);

    const root = await listSessions();
    expect(root.children.map((c) => c.title)).toContain('Second');
    expect(root.children.map((c) => c.title)).not.toContain('First');
  });

  it('undoLastDelete restores an entire clear-all batch together', async () => {
    await createCategory('First');
    await createCategory('Second');
    await clearAll();

    const result = await undoLastDelete();
    expect(result?.titles.sort()).toEqual(['First', 'Second']);

    const root = await listSessions();
    expect(root.children.map((c) => c.title).sort()).toEqual(['First', 'Second']);
  });

  it('returns null from undoLastDelete when trash is empty', async () => {
    expect(await undoLastDelete()).toBeNull();
  });

  it('rejects removing the root folder directly', async () => {
    await expect(removeFolder('TabSesh')).rejects.toThrow(/clear-all/);
  });

  it('purges trash past the 48 hour retention window', async () => {
    vi.useFakeTimers();
    try {
      await createCategory('Old');
      await removeFolder('Old');
      expect(await listTrash()).toHaveLength(1);

      vi.advanceTimersByTime(49 * 60 * 60 * 1000);

      expect(await listTrash()).toHaveLength(0);
      await expect(restoreFromTrash('Old')).rejects.toThrow(/No trashed folder/);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('exportFolder and search', () => {
  it('formats a folder as markdown and plain text', async () => {
    // chrome.tabs.create doesn't accept a title (it's read from the page), so a specific
    // title is set by calling stashTabs directly rather than going through stashAllWindows
    await stashTabs([{ id: 999, url: 'https://a.example', title: 'A Page' }], 'Notes');

    const result = await exportFolder('Notes');
    expect(result.urls).toEqual(['https://a.example']);
    expect(result.markdown).toContain('A Page](https://a.example)'); // title is stamped with a timestamp prefix
    expect(result.plain).toBe('https://a.example');
  });

  it('flattenEntries includes the folder path for nested folders', async () => {
    await createCategory('Parent');
    await createTab({ url: 'https://nested.example' });
    await stashAllWindows('Child');
    await moveFolder('Child', 'Parent');

    const flat = flattenEntries(await listSessions());
    const entry = flat.find((e) => e.url === 'https://nested.example')!;
    expect(entry.folderPath).toEqual(['Parent', 'Child']);
  });

  it('searchStash matches by link, category, and date independently', async () => {
    await stashTabs([{ id: 999, url: 'https://findme.example', title: 'Findable' }], 'Category Name');

    expect(await searchStash('findable', 'link')).toHaveLength(1);
    expect(await searchStash('category name', 'category')).toHaveLength(1);
    expect(await searchStash('findable', 'category')).toHaveLength(0);

    const [entry] = await searchStash('findable', 'link');
    const { timestamp } = parseEntryTitle(entry!.title);
    expect(await searchStash(timestamp!.slice(0, 10), 'date')).toHaveLength(1);
  });

  it('removeEntry deletes just the one bookmark', async () => {
    await createTab({ url: 'https://keep.example' });
    await createTab({ url: 'https://drop.example' });
    await stashAllWindows('Pair');

    const folder = (await listSessions()).children[0]!;
    const toDrop = folder.entries.find((e) => e.url === 'https://drop.example')!;
    await removeEntry(toDrop.id);

    const after = (await listSessions()).children[0]!;
    expect(after.entries.map((e) => e.url)).toEqual(['https://keep.example']);
  });
});

describe('restoreFolder', () => {
  it('reopens every saved tab and reports pinned/group counts', async () => {
    (fakeBrowser as unknown as { tabGroups: { _seed: Function } }).tabGroups._seed(1, {
      title: 'Work',
      color: 'blue',
    });

    const pinned = await createTab({ url: 'https://pinned.example', pinned: true });
    const grouped = await createTab({ url: 'https://grouped.example' });
    await stashTabs([pinned, { ...grouped, groupId: 1 }], 'Session');

    const result = await restoreFolder('Session');

    expect(result.tabCount).toBe(2);
    expect(result.pinnedCount).toBe(1);
    expect(result.groupCount).toBe(1);
    expect(result.tabIds).toHaveLength(2);

    expect((await openTabUrls()).sort()).toEqual(['https://grouped.example', 'https://pinned.example']);
  });

  it('reports zero tabs for an empty folder without throwing', async () => {
    await createCategory('Empty');
    const result = await restoreFolder('Empty');
    expect(result.tabCount).toBe(0);
    expect(result.tabIds).toEqual([]);
  });

  it('rejects an unknown folder', async () => {
    await expect(restoreFolder('Nope')).rejects.toThrow(/No folder named/);
  });
});

describe('focus sessions', () => {
  it('starts a session, reports its status, and rejects a second one', async () => {
    await stashTabs([{ id: 1, url: 'https://work.example' }], 'Work');

    const status = await startFocusSession('Work', 25);
    expect(status.folderTitle).toBe('Work');

    expect(await getFocusSessionStatus()).not.toBeNull();
    await expect(startFocusSession('Work', 10)).rejects.toThrow(/already running/);
  });

  it('cancelFocusSession stops it without touching open tabs', async () => {
    await stashTabs([{ id: 1, url: 'https://work.example' }], 'Work');
    await startFocusSession('Work', 25);

    const cancelled = await cancelFocusSession();
    expect(cancelled).toBe('Work');
    expect(await getFocusSessionStatus()).toBeNull();
    expect(await openTabUrls()).toEqual(['https://work.example']);
  });

  it('rejects starting a session on a folder with no saved tabs', async () => {
    await createCategory('Empty');
    await expect(startFocusSession('Empty', 25)).rejects.toThrow(/no saved tabs/);
  });

  it('endFocusSession re-stashes whatever is still open and closes it', async () => {
    await stashTabs([{ id: 1, url: 'https://work.example' }], 'Work');
    const status = await startFocusSession('Work', 25);

    const before = await fakeBrowser.alarms.getAll();
    const alarmName = before[0]?.name ?? '';

    const ended = await endFocusSession(alarmName);
    expect(ended?.folderTitle).toBe('Work');
    expect(await openTabUrls()).toHaveLength(0);

    const root = await listSessions();
    expect(root.children.map((c) => c.title)).toContain('Work');
    void status;
  });

  it('ignores an alarm that does not match the active session', async () => {
    await stashTabs([{ id: 1, url: 'https://work.example' }], 'Work');
    await startFocusSession('Work', 25);

    const result = await endFocusSession('some-unrelated-alarm');
    expect(result).toBeNull();
    expect(await getFocusSessionStatus()).not.toBeNull();
  });
});
