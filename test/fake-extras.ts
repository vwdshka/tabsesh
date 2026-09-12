import { vi } from 'vitest';

// @webext-core/fake-browser doesn't implement bookmarks or tabGroups, so this is a small
// in-memory stand-in covering exactly what src/lib/core/bookmarks.ts calls.

interface Node {
  id: string;
  parentId?: string;
  title: string;
  url?: string;
  dateAdded: number;
  children?: Node[];
}

function clone(node: Node): Node {
  return { ...node, children: node.children?.map(clone) };
}

function findParentArray(root: Node, id: string): Node[] | undefined {
  if (root.children?.some((c) => c.id === id)) return root.children;
  for (const child of root.children ?? []) {
    const found = findParentArray(child, id);
    if (found) return found;
  }
  return undefined;
}

function findNode(root: Node, id: string): Node | undefined {
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return undefined;
}

export function createFakeBookmarksApi() {
  let nextId = 100;
  const root: Node = {
    id: '0',
    title: 'root',
    dateAdded: 0,
    children: [
      { id: '1', parentId: '0', title: 'Bookmarks Bar', dateAdded: 0, children: [] },
      { id: '2', parentId: '0', title: 'Other Bookmarks', dateAdded: 0, children: [] },
    ],
  };

  return {
    async getTree() {
      return [clone(root)];
    },
    async get(id: string) {
      const node = findNode(root, id);
      if (!node) throw new Error(`fake bookmarks: no node ${id}`);
      return [clone({ ...node, children: undefined })];
    },
    async getSubTree(id: string) {
      const node = findNode(root, id);
      if (!node) throw new Error(`fake bookmarks: no node ${id}`);
      return [clone(node)];
    },
    async create(opts: { parentId?: string; title: string; url?: string }) {
      const parent = opts.parentId ? findNode(root, opts.parentId) : root;
      if (!parent) throw new Error(`fake bookmarks: no parent ${opts.parentId}`);
      const node: Node = {
        id: String(nextId++),
        parentId: parent.id,
        title: opts.title,
        url: opts.url,
        dateAdded: Date.now(),
        children: opts.url ? undefined : [],
      };
      parent.children ??= [];
      parent.children.push(node);
      return clone(node);
    },
    async update(id: string, changes: { title?: string }) {
      const node = findNode(root, id);
      if (!node) throw new Error(`fake bookmarks: no node ${id}`);
      if (changes.title !== undefined) node.title = changes.title;
      return clone(node);
    },
    async move(id: string, dest: { parentId: string }) {
      const node = findNode(root, id);
      const newParent = findNode(root, dest.parentId);
      if (!node || !newParent) throw new Error('fake bookmarks: move target missing');
      const oldSiblings = findParentArray(root, id);
      if (oldSiblings) oldSiblings.splice(oldSiblings.indexOf(node), 1);
      newParent.children ??= [];
      newParent.children.push(node);
      node.parentId = newParent.id;
      return clone(node);
    },
    async remove(id: string) {
      const siblings = findParentArray(root, id);
      if (!siblings) throw new Error(`fake bookmarks: no node ${id}`);
      const index = siblings.findIndex((n) => n.id === id);
      siblings.splice(index, 1);
    },
    async removeTree(id: string) {
      const siblings = findParentArray(root, id);
      if (!siblings) throw new Error(`fake bookmarks: no node ${id}`);
      const index = siblings.findIndex((n) => n.id === id);
      siblings.splice(index, 1);
    },
  };
}

export function createFakeTabGroupsApi() {
  const groups = new Map<number, { title: string; color: string }>();
  return {
    _seed(id: number, group: { title: string; color: string }) {
      groups.set(id, group);
    },
    async get(id: number) {
      const group = groups.get(id);
      if (!group) throw new Error(`fake tabGroups: no group ${id}`);
      return { id, ...group };
    },
    async update(id: number, changes: { title?: string; color?: string }) {
      const group = groups.get(id) ?? { title: '', color: 'grey' };
      groups.set(id, { ...group, ...changes });
      return { id, ...groups.get(id)! };
    },
  };
}

export function createFakeTabsGroupFn() {
  let nextGroupId = 1000;
  return vi.fn(async (_opts: { tabIds: number[] }) => nextGroupId++);
}
