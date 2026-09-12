import type {
  SessionFolder,
  StashResult,
  ExportResult,
  FlatEntry,
  SearchMode,
  DuplicateTab,
  TrashedFolder,
  UndoResult,
} from './types';
import {
  setEntryMeta,
  getEntryMeta,
  deleteEntryMeta,
  setTrashMeta,
  getAllTrash,
  deleteTrashMeta,
  getKeepBrowserOpen,
  getFocusSession,
  setFocusSession,
  type EntryMeta,
  type TrashMeta,
} from './storage';
import { estimateMemoryFreed } from './memory';

interface Tab {
  id?: number;
  url?: string;
  title?: string;
  pinned?: boolean;
  groupId?: number;
}

const NO_GROUP = -1; // chrome.tabGroups.TAB_GROUP_ID_NONE

export const ROOT_FOLDER_TITLE = 'TabSesh';
const LEGACY_ROOT_FOLDER_TITLE = 'tab-cli'; // old extension name, migrated on first run
const TRASH_FOLDER_TITLE = '.trash';
const TRASH_RETENTION_MS = 48 * 60 * 60 * 1000;

interface BookmarkNode {
  id: string;
  title: string;
  url?: string;
  dateAdded?: number;
  children?: BookmarkNode[];
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

export function formatTimestamp(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

const STAMP_PATTERN = /^\[(.+?)\]\s*(.*)$/;

export function parseEntryTitle(title: string): { timestamp: string | null; label: string } {
  const match = title.match(STAMP_PATTERN);
  if (!match) return { timestamp: null, label: title };
  return { timestamp: match[1] ?? null, label: match[2] || title };
}

async function findByTitle(nodes: BookmarkNode[], title: string): Promise<BookmarkNode | undefined> {
  for (const node of nodes) {
    if (node.title.toLowerCase() === title.toLowerCase() && node.children !== undefined) {
      return node;
    }
    if (node.children) {
      const found = await findByTitle(node.children, title);
      if (found) return found;
    }
  }
  return undefined;
}

export async function getOrCreateRootFolder(): Promise<BookmarkNode> {
  const tree = await browser.bookmarks.getTree();
  const existing = await findByTitle(tree, ROOT_FOLDER_TITLE);
  if (existing) return existing;

  // rename in place instead of leaving an orphaned tab-cli folder behind
  const legacy = await findByTitle(tree, LEGACY_ROOT_FOLDER_TITLE);
  if (legacy) {
    await browser.bookmarks.update(legacy.id, { title: ROOT_FOLDER_TITLE });
    return { ...legacy, title: ROOT_FOLDER_TITLE };
  }

  const topLevel = tree[0]?.children ?? [];
  const otherBookmarks = topLevel.find((n) => n.id === '2') ?? topLevel[topLevel.length - 1];
  const parentId = otherBookmarks?.id ?? tree[0]?.id;

  return browser.bookmarks.create({ parentId, title: ROOT_FOLDER_TITLE });
}

async function getOrCreateTrashFolder(root: BookmarkNode): Promise<BookmarkNode> {
  const existing = root.children?.find((c) => c.title === TRASH_FOLDER_TITLE && c.children !== undefined);
  if (existing) return existing;
  return browser.bookmarks.create({ parentId: root.id, title: TRASH_FOLDER_TITLE });
}

// .trash is excluded here on purpose — a soft-deleted folder shouldn't be reachable by name
// until it's restored.
async function findFolder(title: string): Promise<BookmarkNode | undefined> {
  const root = await getOrCreateRootFolder();
  if (!root.children) return undefined;
  if (root.title.toLowerCase() === title.toLowerCase()) return root;
  const visible = root.children.filter((c) => c.title !== TRASH_FOLDER_TITLE);
  return findByTitle(visible, title);
}

function toSessionFolder(node: BookmarkNode): SessionFolder {
  const children = node.children ?? [];
  const entries = children
    .filter((c) => c.url)
    .map((c) => ({ id: c.id, title: c.title, url: c.url!, dateAdded: c.dateAdded ?? 0 }));
  const folders = children.filter((c) => !c.url && c.children !== undefined).map(toSessionFolder);

  return {
    id: node.id,
    title: node.title,
    dateAdded: node.dateAdded ?? 0,
    entries,
    children: folders,
  };
}

export async function listSessions(): Promise<SessionFolder> {
  await purgeExpiredTrash();
  const root = await getOrCreateRootFolder();
  const visible: BookmarkNode = { ...root, children: root.children?.filter((c) => c.title !== TRASH_FOLDER_TITLE) };
  return toSessionFolder(visible);
}

function makeGroupLookup() {
  const cache = new Map<number, { title: string; color: string } | null>();
  return async (groupId: number) => {
    if (cache.has(groupId)) return cache.get(groupId) ?? null;
    try {
      const group = await browser.tabGroups.get(groupId);
      const info = { title: group.title || 'Group', color: group.color };
      cache.set(groupId, info);
      return info;
    } catch {
      cache.set(groupId, null);
      return null;
    }
  };
}

// Shared by stashAllWindows and the focus-session auto-restash — both just need
// "here's a list of tabs, put them in a folder with this name".
export async function stashTabs(tabsToStash: Tab[], folderTitle: string): Promise<StashResult> {
  const root = await getOrCreateRootFolder();
  const stashable = tabsToStash.filter((t) => t.url);

  const existingByUrl = new Map<string, string[]>();
  for (const entry of flattenEntries(await listSessions())) {
    const path = entry.folderPath[entry.folderPath.length - 1] ?? ROOT_FOLDER_TITLE;
    const paths = existingByUrl.get(entry.url) ?? [];
    paths.push(path);
    existingByUrl.set(entry.url, paths);
  }

  const duplicates: DuplicateTab[] = [];

  const folder = await browser.bookmarks.create({ parentId: root.id, title: folderTitle });
  const lookupGroup = makeGroupLookup();
  const meta: Record<string, EntryMeta> = {};

  for (const tab of stashable) {
    const existingIn = existingByUrl.get(tab.url!);
    if (existingIn) {
      duplicates.push({ title: tab.title ?? tab.url!, url: tab.url!, existingIn: [...new Set(existingIn)] });
    }

    const bookmark = await browser.bookmarks.create({
      parentId: folder.id,
      title: `[${formatTimestamp()}] ${tab.title ?? tab.url}`,
      url: tab.url,
    });

    if (tab.groupId !== undefined && tab.groupId !== NO_GROUP) {
      const group = await lookupGroup(tab.groupId);
      if (group) {
        meta[bookmark.id] = { group: { key: String(tab.groupId), ...group } };
        continue;
      }
    }
    if (tab.pinned) {
      meta[bookmark.id] = { pinned: true };
    }
  }

  await setEntryMeta(meta);

  const tabIds = stashable.map((t) => t.id).filter((id): id is number => id !== undefined);
  const memoryFreedBytes = await estimateMemoryFreed(tabIds);

  // closing all of these could mean closing every open tab, i.e. closing the browser
  const allOpenTabs = await browser.tabs.query({});
  const wouldCloseEverything = tabIds.length > 0 && tabIds.length === allOpenTabs.length;
  if (wouldCloseEverything && (await getKeepBrowserOpen())) {
    await browser.tabs.create({});
  }

  if (tabIds.length > 0) {
    await browser.tabs.remove(tabIds);
  }

  const created = await browser.bookmarks.getSubTree(folder.id);
  return { folder: toSessionFolder(created[0]!), tabCount: stashable.length, duplicates, memoryFreedBytes };
}

export async function stashAllWindows(category?: string): Promise<StashResult> {
  const folderTitle = category?.trim() || formatTimestamp();
  const tabs = await browser.tabs.query({});
  const stashable = tabs.filter((t) => t.url && !t.url.startsWith('chrome-extension://'));
  return stashTabs(stashable, folderTitle);
}

export async function createCategory(name: string): Promise<SessionFolder> {
  const root = await getOrCreateRootFolder();
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Category name cannot be empty.');
  if (trimmed === TRASH_FOLDER_TITLE) throw new Error(`"${TRASH_FOLDER_TITLE}" is a reserved name.`);

  const existing = root.children?.find((c) => c.title.toLowerCase() === trimmed.toLowerCase());
  if (existing) throw new Error(`A folder named "${trimmed}" already exists.`);

  const folder = await browser.bookmarks.create({ parentId: root.id, title: trimmed });
  return toSessionFolder(folder);
}

// names have to stay unique across the whole tree since move/rm/copy/restore all look folders up by name
export async function renameFolder(folderName: string, newName: string): Promise<SessionFolder> {
  if (folderName.toLowerCase() === ROOT_FOLDER_TITLE.toLowerCase()) {
    throw new Error('The TabSesh root folder can\'t be renamed.');
  }

  const trimmed = newName.trim();
  if (!trimmed) throw new Error('New name cannot be empty.');
  if (trimmed.toLowerCase() === ROOT_FOLDER_TITLE.toLowerCase()) {
    throw new Error(`"${trimmed}" is reserved for the TabSesh root folder.`);
  }
  if (trimmed === TRASH_FOLDER_TITLE) throw new Error(`"${TRASH_FOLDER_TITLE}" is a reserved name.`);

  const folder = await findFolder(folderName);
  if (!folder) throw new Error(`No folder named "${folderName}" found.`);

  if (trimmed.toLowerCase() !== folder.title.toLowerCase()) {
    const existing = await findFolder(trimmed);
    if (existing) throw new Error(`A folder named "${trimmed}" already exists.`);
  }

  await browser.bookmarks.update(folder.id, { title: trimmed });
  return toSessionFolder({ ...folder, title: trimmed });
}

export async function moveFolder(folderName: string, categoryName: string): Promise<void> {
  const folder = await findFolder(folderName);
  if (!folder) throw new Error(`No folder named "${folderName}" found.`);

  const category = await findFolder(categoryName);
  if (!category) throw new Error(`No category named "${categoryName}" found.`);
  if (category.url) throw new Error(`"${categoryName}" is not a folder.`);
  if (folder.id === category.id) throw new Error('Cannot move a folder into itself.');

  await browser.bookmarks.move(folder.id, { parentId: category.id });
}

function collectEntryIds(node: BookmarkNode): string[] {
  const own = node.url ? [node.id] : [];
  const nested = (node.children ?? []).flatMap(collectEntryIds);
  return [...own, ...nested];
}

async function purgeExpiredTrash(): Promise<void> {
  const root = await getOrCreateRootFolder();
  const trash = root.children?.find((c) => c.title === TRASH_FOLDER_TITLE);
  if (!trash?.children?.length) return;

  const meta = await getAllTrash();
  const now = Date.now();
  const expiredIds: string[] = [];

  for (const child of trash.children) {
    const deletedAt = meta[child.id]?.deletedAt ?? child.dateAdded ?? 0;
    if (now - deletedAt > TRASH_RETENTION_MS) expiredIds.push(child.id);
  }

  if (expiredIds.length === 0) return;

  for (const id of expiredIds) {
    const [node] = await browser.bookmarks.getSubTree(id);
    if (node) await deleteEntryMeta(collectEntryIds(node));
    await browser.bookmarks.removeTree(id);
  }
  await deleteTrashMeta(expiredIds);
}

// soft delete: move to .trash instead of removing outright, so undo/restore-from-trash can still find it
export async function removeFolder(folderName: string): Promise<void> {
  if (folderName.toLowerCase() === ROOT_FOLDER_TITLE.toLowerCase()) {
    throw new Error('Use "clear-all" to wipe the entire TabSesh folder.');
  }
  await purgeExpiredTrash();

  const root = await getOrCreateRootFolder();
  const folder = await findFolder(folderName);
  if (!folder) throw new Error(`No folder named "${folderName}" found.`);

  const [info] = await browser.bookmarks.get(folder.id);
  const originalParentId = info?.parentId ?? root.id;

  const trash = await getOrCreateTrashFolder(root);
  await browser.bookmarks.move(folder.id, { parentId: trash.id });
  await setTrashMeta({
    [folder.id]: { originalTitle: folder.title, originalParentId, deletedAt: Date.now() },
  });
}

export async function clearAll(): Promise<void> {
  await purgeExpiredTrash();

  const root = await getOrCreateRootFolder();
  const toTrash = (root.children ?? []).filter((c) => c.title !== TRASH_FOLDER_TITLE);
  if (toTrash.length === 0) return;

  const trash = await getOrCreateTrashFolder(root);
  const batchId = `clear-all-${Date.now()}`;
  const deletedAt = Date.now();
  const meta: Record<string, TrashMeta> = {};

  for (const child of toTrash) {
    await browser.bookmarks.move(child.id, { parentId: trash.id });
    meta[child.id] = { originalTitle: child.title, originalParentId: root.id, deletedAt, batchId };
  }

  await setTrashMeta(meta);
}

export async function listTrash(): Promise<TrashedFolder[]> {
  await purgeExpiredTrash();

  const root = await getOrCreateRootFolder();
  const trash = root.children?.find((c) => c.title === TRASH_FOLDER_TITLE);
  if (!trash?.children?.length) return [];

  const meta = await getAllTrash();

  return trash.children
    .map((child) => {
      const entryMeta = meta[child.id];
      const deletedAt = entryMeta?.deletedAt ?? child.dateAdded ?? 0;
      return {
        id: child.id,
        title: entryMeta?.originalTitle ?? child.title,
        deletedAt,
        expiresAt: deletedAt + TRASH_RETENTION_MS,
        tabCount: collectEntryIds(child).length,
      };
    })
    .sort((a, b) => b.deletedAt - a.deletedAt);
}

async function restoreTrashedNode(id: string, meta: TrashMeta): Promise<void> {
  const root = await getOrCreateRootFolder();
  try {
    await browser.bookmarks.move(id, { parentId: meta.originalParentId });
  } catch {
    await browser.bookmarks.move(id, { parentId: root.id }); // original parent is gone, fall back to root
  }
  await deleteTrashMeta([id]);
}

export async function restoreFromTrash(folderName: string): Promise<string> {
  await purgeExpiredTrash();
  const trashed = await listTrash();
  const match = trashed.find((t) => t.title.toLowerCase() === folderName.trim().toLowerCase());
  if (!match) throw new Error(`No trashed folder named "${folderName}" found.`);

  const meta = (await getAllTrash())[match.id];
  if (!meta) throw new Error(`No trashed folder named "${folderName}" found.`);

  await restoreTrashedNode(match.id, meta);
  return match.title;
}

// if the most recent deletion was part of a clear-all batch, the whole batch comes back together
export async function undoLastDelete(): Promise<UndoResult | null> {
  await purgeExpiredTrash();
  const meta = await getAllTrash();
  const entries = Object.entries(meta);
  if (entries.length === 0) return null;

  // Object.entries preserves insertion order, so scanning forward with >= (not >) means a tie in
  // deletedAt resolves to whichever was actually deleted later, instead of an arbitrary sort order.
  let [mostRecentId, mostRecent] = entries[0]!;
  for (const [id, m] of entries) {
    if (m.deletedAt >= mostRecent.deletedAt) [mostRecentId, mostRecent] = [id, m];
  }

  const batch = mostRecent.batchId
    ? entries.filter(([, m]) => m.batchId === mostRecent.batchId)
    : [[mostRecentId, mostRecent] as const];

  const titles: string[] = [];
  for (const [id, m] of batch) {
    await restoreTrashedNode(id, m);
    titles.push(m.originalTitle);
  }

  return { titles };
}

function collectUrls(folder: SessionFolder): { title: string; url: string }[] {
  const own = folder.entries.map((e) => ({ title: e.title, url: e.url }));
  const nested = folder.children.flatMap(collectUrls);
  return [...own, ...nested];
}

export async function exportFolder(folderName: string): Promise<ExportResult> {
  const folder = await findFolder(folderName);
  if (!folder) throw new Error(`No folder named "${folderName}" found.`);

  const sessionFolder = toSessionFolder(folder);
  const items = collectUrls(sessionFolder);

  return {
    folderTitle: folder.title,
    urls: items.map((i) => i.url),
    markdown: items.map((i) => `- [${i.title}](${i.url})`).join('\n'),
    plain: items.map((i) => i.url).join('\n'),
  };
}

export async function removeEntry(entryId: string): Promise<void> {
  await browser.bookmarks.remove(entryId);
  await deleteEntryMeta([entryId]);
}

export function flattenEntries(folder: SessionFolder, path: string[] = []): FlatEntry[] {
  const here: FlatEntry[] = folder.entries.map((e) => ({ ...e, folderPath: path }));
  const nested = folder.children.flatMap((child) => flattenEntries(child, [...path, child.title]));
  return [...here, ...nested];
}

// mode: link matches title/url, category matches folder path, date matches the [timestamp] stamp, all matches any
export async function searchStash(query: string, mode: SearchMode = 'all'): Promise<FlatEntry[]> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const root = await listSessions();
  const all = flattenEntries(root);

  return all.filter((entry) => {
    const { timestamp, label } = parseEntryTitle(entry.title);
    const matchesLink = label.toLowerCase().includes(needle) || entry.url.toLowerCase().includes(needle);
    const matchesCategory = entry.folderPath.some((p) => p.toLowerCase().includes(needle));
    const matchesDate = (timestamp ?? '').toLowerCase().includes(needle);

    switch (mode) {
      case 'link':
        return matchesLink;
      case 'category':
        return matchesCategory;
      case 'date':
        return matchesDate;
      default:
        return matchesLink || matchesCategory || matchesDate;
    }
  });
}

export interface RestoreResult {
  folderTitle: string;
  tabCount: number;
  groupCount: number;
  pinnedCount: number;
  tabIds: number[];
}

export async function restoreFolder(folderName: string): Promise<RestoreResult> {
  const folder = await findFolder(folderName);
  if (!folder) throw new Error(`No folder named "${folderName}" found.`);

  const entries = flattenEntries(toSessionFolder(folder));
  if (entries.length === 0) {
    return { folderTitle: folder.title, tabCount: 0, groupCount: 0, pinnedCount: 0, tabIds: [] };
  }

  const metaMap = await getEntryMeta(entries.map((e) => e.id));

  const created = await Promise.all(entries.map((e) => browser.tabs.create({ url: e.url, active: false })));
  const tabIds = created.map((t) => t.id);

  const groupBuckets = new Map<string, { title: string; color: string; tabIds: number[] }>();
  const pinnedTabIds: number[] = [];

  entries.forEach((entry, i) => {
    const tabId = tabIds[i];
    if (tabId === undefined) return;
    const meta = metaMap[entry.id];
    if (!meta) return;

    if (meta.group) {
      const bucket = groupBuckets.get(meta.group.key) ?? {
        title: meta.group.title,
        color: meta.group.color,
        tabIds: [],
      };
      bucket.tabIds.push(tabId);
      groupBuckets.set(meta.group.key, bucket);
    } else if (meta.pinned) {
      pinnedTabIds.push(tabId);
    }
  });

  for (const tabId of pinnedTabIds) {
    await browser.tabs.update(tabId, { pinned: true });
  }

  type TabGroupColor = 'grey' | 'blue' | 'red' | 'yellow' | 'green' | 'pink' | 'purple' | 'cyan' | 'orange';

  for (const bucket of groupBuckets.values()) {
    const [firstId, ...restIds] = bucket.tabIds;
    if (firstId === undefined) continue;
    const groupId: number = await browser.tabs.group({ tabIds: [firstId, ...restIds] });
    await browser.tabGroups.update(groupId, {
      title: bucket.title,
      color: bucket.color as TabGroupColor,
    });
  }

  const firstTabId = tabIds[0];
  if (firstTabId !== undefined) {
    await browser.tabs.update(firstTabId, { active: true });
  }

  return {
    folderTitle: folder.title,
    tabCount: entries.length,
    groupCount: groupBuckets.size,
    pinnedCount: pinnedTabIds.length,
    tabIds: tabIds.filter((id): id is number => id !== undefined),
  };
}

const FOCUS_ALARM_PREFIX = 'tabsesh-focus-session';

export interface FocusSessionStatus {
  folderTitle: string;
  endsAt: number;
}

export async function startFocusSession(folderName: string, minutes: number): Promise<FocusSessionStatus> {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new Error('Focus session length must be a positive number of minutes.');
  }

  const existing = await getFocusSession();
  if (existing) {
    throw new Error(`A focus session for "${existing.folderTitle}" is already running — cancel it first.`);
  }

  const result = await restoreFolder(folderName);
  if (result.tabCount === 0) {
    throw new Error(`"${folderName}" has no saved tabs to start a focus session with.`);
  }

  const alarmName = `${FOCUS_ALARM_PREFIX}:${Date.now()}`;
  const endsAt = Date.now() + minutes * 60_000;

  await browser.alarms.create(alarmName, { delayInMinutes: minutes });
  await setFocusSession({ folderTitle: result.folderTitle, tabIds: result.tabIds, endsAt, alarmName });

  return { folderTitle: result.folderTitle, endsAt };
}

export async function cancelFocusSession(): Promise<string | null> {
  const session = await getFocusSession();
  if (!session) return null;
  await browser.alarms.clear(session.alarmName);
  await setFocusSession(null);
  return session.folderTitle;
}

export async function getFocusSessionStatus(): Promise<FocusSessionStatus | null> {
  const session = await getFocusSession();
  return session ? { folderTitle: session.folderTitle, endsAt: session.endsAt } : null;
}

// called from the background worker when a focus session's alarm fires
export async function endFocusSession(alarmName: string): Promise<FocusSessionStatus | null> {
  const session = await getFocusSession();
  if (!session || session.alarmName !== alarmName) return null;
  await setFocusSession(null);

  const stillOpen: Tab[] = [];
  for (const id of session.tabIds) {
    try {
      const tab = await browser.tabs.get(id);
      if (tab.url) stillOpen.push(tab);
    } catch {
      // already closed by the user, nothing to capture
    }
  }

  if (stillOpen.length === 0) return { folderTitle: session.folderTitle, endsAt: session.endsAt };

  try {
    await removeFolder(session.folderTitle);
  } catch {
    // folder was renamed/moved/deleted in the meantime, proceed anyway
  }

  await stashTabs(stillOpen, session.folderTitle);
  return { folderTitle: session.folderTitle, endsAt: session.endsAt };
}
