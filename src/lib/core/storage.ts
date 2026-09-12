const TERMINAL_COLOR_KEY = 'tabsesh:terminalColor';
const INTERFACE_MODE_KEY = 'tabsesh:interfaceMode';

export const DEFAULT_TERMINAL_COLOR = '#22c55e';

export type InterfaceMode = 'tui' | 'gui';

export async function getTerminalColor(): Promise<string> {
  const stored = await browser.storage.local.get(TERMINAL_COLOR_KEY);
  return (stored[TERMINAL_COLOR_KEY] as string | undefined) ?? DEFAULT_TERMINAL_COLOR;
}

export async function setTerminalColor(hex: string): Promise<void> {
  await browser.storage.local.set({ [TERMINAL_COLOR_KEY]: hex });
}

export async function getInterfaceMode(): Promise<InterfaceMode> {
  const stored = await browser.storage.local.get(INTERFACE_MODE_KEY);
  return (stored[INTERFACE_MODE_KEY] as InterfaceMode | undefined) ?? 'gui';
}

export async function setInterfaceMode(mode: InterfaceMode): Promise<void> {
  await browser.storage.local.set({ [INTERFACE_MODE_KEY]: mode });
}

export function isValidHexColor(value: string): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim());
}

const KEEP_BROWSER_OPEN_KEY = 'tabsesh:keepBrowserOpen';

// defaults to true - closing every tab in every window also closes the browser, and that
// should never be a surprise
export async function getKeepBrowserOpen(): Promise<boolean> {
  const stored = await browser.storage.local.get(KEEP_BROWSER_OPEN_KEY);
  return (stored[KEEP_BROWSER_OPEN_KEY] as boolean | undefined) ?? true;
}

export async function setKeepBrowserOpen(value: boolean): Promise<void> {
  await browser.storage.local.set({ [KEEP_BROWSER_OPEN_KEY]: value });
}

export interface EntryMeta {
  pinned?: boolean;
  group?: { key: string; title: string; color: string };
}

const ENTRY_META_KEY = 'tabsesh:entryMeta';

async function getAllEntryMeta(): Promise<Record<string, EntryMeta>> {
  const stored = await browser.storage.local.get(ENTRY_META_KEY);
  return (stored[ENTRY_META_KEY] as Record<string, EntryMeta> | undefined) ?? {};
}

export async function setEntryMeta(entries: Record<string, EntryMeta>): Promise<void> {
  if (Object.keys(entries).length === 0) return;
  const all = await getAllEntryMeta();
  await browser.storage.local.set({ [ENTRY_META_KEY]: { ...all, ...entries } });
}

export async function getEntryMeta(ids: string[]): Promise<Record<string, EntryMeta>> {
  const all = await getAllEntryMeta();
  const result: Record<string, EntryMeta> = {};
  for (const id of ids) {
    if (all[id]) result[id] = all[id];
  }
  return result;
}

export async function deleteEntryMeta(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const all = await getAllEntryMeta();
  for (const id of ids) delete all[id];
  await browser.storage.local.set({ [ENTRY_META_KEY]: all });
}

export interface TrashMeta {
  originalTitle: string;
  originalParentId: string;
  deletedAt: number;
  batchId?: string; // shared by everything deleted together in one clear-all
}

const TRASH_META_KEY = 'tabsesh:trashMeta';

async function getAllTrashMeta(): Promise<Record<string, TrashMeta>> {
  const stored = await browser.storage.local.get(TRASH_META_KEY);
  return (stored[TRASH_META_KEY] as Record<string, TrashMeta> | undefined) ?? {};
}

export async function setTrashMeta(entries: Record<string, TrashMeta>): Promise<void> {
  if (Object.keys(entries).length === 0) return;
  const all = await getAllTrashMeta();
  await browser.storage.local.set({ [TRASH_META_KEY]: { ...all, ...entries } });
}

export async function getAllTrash(): Promise<Record<string, TrashMeta>> {
  return getAllTrashMeta();
}

export async function deleteTrashMeta(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const all = await getAllTrashMeta();
  for (const id of ids) delete all[id];
  await browser.storage.local.set({ [TRASH_META_KEY]: all });
}

export interface FocusSessionRecord {
  folderTitle: string;
  tabIds: number[];
  endsAt: number;
  alarmName: string;
}

const FOCUS_SESSION_KEY = 'tabsesh:focusSession';

export async function getFocusSession(): Promise<FocusSessionRecord | null> {
  const stored = await browser.storage.local.get(FOCUS_SESSION_KEY);
  return (stored[FOCUS_SESSION_KEY] as FocusSessionRecord | undefined) ?? null;
}

export async function setFocusSession(record: FocusSessionRecord | null): Promise<void> {
  if (record === null) {
    await browser.storage.local.remove(FOCUS_SESSION_KEY);
  } else {
    await browser.storage.local.set({ [FOCUS_SESSION_KEY]: record });
  }
}

const GITHUB_TOKEN_KEY = 'tabsesh:githubToken';

// gist-scope personal access token, used only for Share - never sent anywhere but api.github.com
export async function getGithubToken(): Promise<string | null> {
  const stored = await browser.storage.local.get(GITHUB_TOKEN_KEY);
  return (stored[GITHUB_TOKEN_KEY] as string | undefined) ?? null;
}

export async function setGithubToken(token: string | null): Promise<void> {
  if (!token) {
    await browser.storage.local.remove(GITHUB_TOKEN_KEY);
  } else {
    await browser.storage.local.set({ [GITHUB_TOKEN_KEY]: token });
  }
}
