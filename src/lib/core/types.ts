export interface SessionEntry {
  id: string;
  title: string;
  url: string;
  dateAdded: number;
}

export interface SessionFolder {
  id: string;
  title: string;
  dateAdded: number;
  entries: SessionEntry[]; // tabs directly in this folder
  children: SessionFolder[]; // nested folders (categories, or sessions moved into one)
}

export interface DuplicateTab {
  title: string;
  url: string;
  existingIn: string[]; // where this url was already saved before this stash
}

export interface StashResult {
  folder: SessionFolder;
  tabCount: number;
  duplicates: DuplicateTab[];
  memoryFreedBytes: number | null; // null if the estimate wasn't available
}

export interface TrashedFolder {
  id: string;
  title: string;
  deletedAt: number;
  expiresAt: number;
  tabCount: number;
}

export interface UndoResult {
  titles: string[];
}

export interface ExportResult {
  folderTitle: string;
  urls: string[];
  markdown: string;
  plain: string;
}

export interface FlatEntry {
  id: string;
  title: string;
  url: string;
  dateAdded: number;
  folderPath: string[]; // root down to this entry's direct parent, e.g. ["Projects", "Work research"]
}

export type SearchMode = 'all' | 'category' | 'link' | 'date';
