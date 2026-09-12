import { fakeBrowser } from '@webext-core/fake-browser';
import { beforeEach, vi } from 'vitest';
import { createFakeBookmarksApi, createFakeTabGroupsApi, createFakeTabsGroupFn } from './fake-extras';

// captured once, before any test wraps it, so repeated beforeEach runs never wrap a wrapper
const originalTabsRemove = fakeBrowser.tabs.remove.bind(fakeBrowser.tabs);

beforeEach(() => {
  fakeBrowser.reset();
  (fakeBrowser as unknown as Record<string, unknown>).bookmarks = createFakeBookmarksApi();
  (fakeBrowser as unknown as Record<string, unknown>).tabGroups = createFakeTabGroupsApi();
  (fakeBrowser.tabs as unknown as Record<string, unknown>).group = createFakeTabsGroupFn();

  // @webext-core/fake-browser's tabs.remove() looks up a window by the tab's own id
  // instead of its windowId, which throws once more than one window/tab id is in play.
  // The tab is already spliced out of its internal list by the time that happens, so
  // it's safe to just swallow it per-id here rather than let one bad id block the rest.
  fakeBrowser.tabs.remove = vi.fn(async (idOrIds: number | number[]) => {
    const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
    for (const id of ids) {
      try {
        await originalTabsRemove(id);
      } catch {
        // removal itself already happened - this is the library's own post-removal bug
      }
    }
  }) as typeof fakeBrowser.tabs.remove;
});
