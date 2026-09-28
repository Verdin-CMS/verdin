import { MenuItem } from './site';

/** The server's limits (`site.rs`). */
export const MAX_MENU_DEPTH = 5;
export const MAX_MENU_ITEMS = 500;

/** A menu item in the editor: `key` identifies it while it moves (never saved). */
export interface MenuNode {
  key: string;
  label: string;
  /** `url` or `entry`; `none` is a plain heading. */
  link: 'url' | 'entry' | 'none';
  url: string;
  entry: { uid: string; documentId: string; title?: string } | null;
  target: '_self' | '_blank';
  children: MenuNode[];
}

/** A node as a row of the flattened tree (what the editor lists). */
export interface MenuRow {
  node: MenuNode;
  /** 1 for top-level items. */
  depth: number;
  path: number[];
  /** The number of siblings, the node included. */
  siblings: number;
}

let counter = 0;
/** A key unique within the session. */
export function newKey(): string {
  counter += 1;
  return `m${counter}`;
}

export function emptyNode(label = ''): MenuNode {
  return {
    key: newKey(),
    label,
    link: 'url',
    url: '',
    entry: null,
    target: '_self',
    children: [],
  };
}

/** Stored items → editor nodes. Unknown shapes become empty labels (the save will say so). */
export function fromItems(items: unknown): MenuNode[] {
  if (!Array.isArray(items)) return [];
  return items.map((raw) => {
    const item = (raw && typeof raw === 'object' ? raw : {}) as Partial<MenuItem>;
    const entry =
      item.entry && typeof item.entry === 'object'
        ? { uid: String(item.entry.uid ?? ''), documentId: String(item.entry.documentId ?? '') }
        : null;
    return {
      key: newKey(),
      label: typeof item.label === 'string' ? item.label : '',
      link: entry ? 'entry' : typeof item.url === 'string' ? 'url' : 'none',
      url: typeof item.url === 'string' ? item.url : '',
      entry,
      target: item.target === '_blank' ? '_blank' : '_self',
      children: fromItems(item.children),
    };
  });
}

/** Editor nodes → the items the server stores. */
export function toItems(nodes: readonly MenuNode[]): MenuItem[] {
  return nodes.map((node) => {
    const item: MenuItem = { label: node.label.trim() };
    if (node.link === 'url' && node.url.trim()) item.url = node.url.trim();
    if (node.link === 'entry' && node.entry) {
      item.entry = { uid: node.entry.uid, documentId: node.entry.documentId };
    }
    if (node.target === '_blank') item.target = '_blank';
    if (node.children.length) item.children = toItems(node.children);
    return item;
  });
}

export function flatten(nodes: readonly MenuNode[], depth = 1, prefix: number[] = []): MenuRow[] {
  const rows: MenuRow[] = [];
  nodes.forEach((node, index) => {
    const path = [...prefix, index];
    rows.push({ node, depth, path, siblings: nodes.length });
    rows.push(...flatten(node.children, depth + 1, path));
  });
  return rows;
}

export function countItems(nodes: readonly MenuNode[]): number {
  return nodes.reduce((sum, node) => sum + 1 + countItems(node.children), 0);
}

/** Levels in a subtree: 1 for a node without children. */
export function height(node: MenuNode): number {
  return 1 + Math.max(0, ...node.children.map(height));
}

/** The deepest level of the tree (0 when empty). */
export function treeDepth(nodes: readonly MenuNode[]): number {
  return Math.max(0, ...nodes.map(height));
}

export function findPath(nodes: readonly MenuNode[], key: string): number[] | null {
  for (let index = 0; index < nodes.length; index++) {
    if (nodes[index].key === key) return [index];
    const inner = findPath(nodes[index].children, key);
    if (inner) return [index, ...inner];
  }
  return null;
}

export function findNode(nodes: readonly MenuNode[], key: string): MenuNode | null {
  const path = findPath(nodes, key);
  return path ? nodeAt(nodes, path) : null;
}

function nodeAt(nodes: readonly MenuNode[], path: readonly number[]): MenuNode {
  let node = nodes[path[0]];
  for (const index of path.slice(1)) node = node.children[index];
  return node;
}

/** A deep copy, so operations never mutate the signal's value. */
function clone(nodes: readonly MenuNode[]): MenuNode[] {
  return nodes.map((node) => ({
    ...node,
    entry: node.entry ? { ...node.entry } : null,
    children: clone(node.children),
  }));
}

/** The list holding the node at `path` (the root list or a node's children). */
function siblingsOf(nodes: MenuNode[], path: readonly number[]): MenuNode[] {
  return path.length === 1 ? nodes : nodeAt(nodes, path.slice(0, -1)).children;
}

/** The tree with one node changed. */
export function updateNode(
  nodes: readonly MenuNode[],
  key: string,
  change: Partial<Omit<MenuNode, 'key' | 'children'>>,
): MenuNode[] {
  return nodes.map((node) =>
    node.key === key
      ? { ...node, ...change }
      : { ...node, children: updateNode(node.children, key, change) },
  );
}

/** Adds `node` at the end of `parentKey`'s children (`null`: at the top level). */
export function addNode(
  nodes: readonly MenuNode[],
  parentKey: string | null,
  node: MenuNode,
): MenuNode[] | null {
  if (countItems(nodes) + countItems([node]) > MAX_MENU_ITEMS) return null;
  const tree = clone(nodes);
  if (parentKey === null) return [...tree, node];
  const path = findPath(tree, parentKey);
  if (!path || path.length + height(node) > MAX_MENU_DEPTH) return null;
  nodeAt(tree, path).children.push(node);
  return tree;
}

/** The tree without the node (and its children). */
export function removeNode(nodes: readonly MenuNode[], key: string): MenuNode[] {
  return nodes
    .filter((node) => node.key !== key)
    .map((node) => ({ ...node, children: removeNode(node.children, key) }));
}

/** Swaps a node with its previous (`-1`) or next (`1`) sibling. */
export function moveNode(
  nodes: readonly MenuNode[],
  key: string,
  delta: -1 | 1,
): MenuNode[] | null {
  const tree = clone(nodes);
  const path = findPath(tree, key);
  if (!path) return null;
  const list = siblingsOf(tree, path);
  const from = path[path.length - 1];
  const to = from + delta;
  if (to < 0 || to >= list.length) return null;
  [list[from], list[to]] = [list[to], list[from]];
  return tree;
}

/** Whether the node can become the last child of its previous sibling. */
export function canIndent(nodes: readonly MenuNode[], key: string): boolean {
  const path = findPath(nodes, key);
  if (!path || path[path.length - 1] === 0) return false;
  return path.length + height(nodeAt(nodes, path)) <= MAX_MENU_DEPTH;
}

/** Makes the node the last child of its previous sibling. */
export function indent(nodes: readonly MenuNode[], key: string): MenuNode[] | null {
  if (!canIndent(nodes, key)) return null;
  const tree = clone(nodes);
  const path = findPath(tree, key)!;
  const list = siblingsOf(tree, path);
  const index = path[path.length - 1];
  const [node] = list.splice(index, 1);
  list[index - 1].children.push(node);
  return tree;
}

export function canOutdent(nodes: readonly MenuNode[], key: string): boolean {
  const path = findPath(nodes, key);
  return !!path && path.length > 1;
}

/**
 * Makes the node the next sibling of its parent. Its following siblings stay where they
 * are (they do not become its children), as in most outline editors.
 */
export function outdent(nodes: readonly MenuNode[], key: string): MenuNode[] | null {
  if (!canOutdent(nodes, key)) return null;
  const tree = clone(nodes);
  const path = findPath(tree, key)!;
  const list = siblingsOf(tree, path);
  const [node] = list.splice(path[path.length - 1], 1);
  const parentPath = path.slice(0, -1);
  siblingsOf(tree, parentPath).splice(parentPath[parentPath.length - 1] + 1, 0, node);
  return tree;
}

/**
 * Moves the node shown at row `from` of the flattened tree to row `to` (a drag and
 * drop): moving up, it goes before the row at `to`, as its sibling; moving down, it goes
 * after it, as its first child when that row has children, else as its next sibling.
 * Returns `null` when the move is not possible (into itself, or deeper than allowed).
 */
export function moveRow(nodes: readonly MenuNode[], from: number, to: number): MenuNode[] | null {
  const rows = flatten(nodes);
  const dragged = rows[from];
  const target = rows[to];
  if (!dragged || !target || from === to) return null;
  const size = countItems([dragged.node]);
  // Into its own subtree.
  if (to > from && to < from + size) return null;
  const key = dragged.node.key;
  const targetKey = target.node.key;
  const without = removeNode(nodes, key);
  const tree = clone(without);
  const node = clone([dragged.node])[0];
  const path = findPath(tree, targetKey)!;
  let parentDepth: number;
  if (to < from) {
    siblingsOf(tree, path).splice(path[path.length - 1], 0, node);
    parentDepth = path.length - 1;
  } else {
    const targetNode = nodeAt(tree, path);
    if (targetNode.children.length) {
      targetNode.children.unshift(node);
      parentDepth = path.length;
    } else {
      siblingsOf(tree, path).splice(path[path.length - 1] + 1, 0, node);
      parentDepth = path.length - 1;
    }
  }
  if (parentDepth + height(node) > MAX_MENU_DEPTH) return null;
  return tree;
}

/** What is wrong with one item (message keys are chosen by the editor). */
export type ItemProblem = 'label' | 'labelLength' | 'url' | 'entry';

/** Links the server accepts: a path, `#anchor`, or an http(s), mailto: or tel: URL. */
export function validMenuUrl(url: string): boolean {
  const text = url.trim();
  if (text.startsWith('/') || text.startsWith('#')) return true;
  try {
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(new URL(text).protocol);
  } catch {
    return false;
  }
}

export function itemProblems(node: MenuNode): ItemProblem[] {
  const problems: ItemProblem[] = [];
  const label = node.label.trim();
  if (!label) problems.push('label');
  else if ([...label].length > 255) problems.push('labelLength');
  if (node.link === 'url' && node.url.trim() && !validMenuUrl(node.url)) problems.push('url');
  if (node.link === 'entry' && !(node.entry?.uid && node.entry.documentId)) problems.push('entry');
  return problems;
}

/** Problems by node key, for every item that has some. */
export function treeProblems(nodes: readonly MenuNode[]): Map<string, ItemProblem[]> {
  const problems = new Map<string, ItemProblem[]>();
  for (const row of flatten(nodes)) {
    const found = itemProblems(row.node);
    if (found.length) problems.set(row.node.key, found);
  }
  return problems;
}
