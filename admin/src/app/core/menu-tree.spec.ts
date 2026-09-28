import { describe, expect, it } from 'vitest';

import {
  MAX_MENU_DEPTH,
  MenuNode,
  addNode,
  canIndent,
  canOutdent,
  countItems,
  emptyNode,
  flatten,
  fromItems,
  indent,
  itemProblems,
  moveNode,
  moveRow,
  outdent,
  removeNode,
  toItems,
  treeDepth,
  treeProblems,
  updateNode,
  validMenuUrl,
} from './menu-tree';

function node(label: string, children: MenuNode[] = []): MenuNode {
  return { ...emptyNode(label), key: label, url: `/${label}`, children };
}

/** The tree as nested labels, to compare shapes. */
function shape(nodes: MenuNode[] | null): unknown {
  if (!nodes) return null;
  return nodes.map((item) =>
    item.children.length ? { [item.label]: shape(item.children) } : item.label,
  );
}

/** A chain of `levels` nested nodes: a > a1 > a2 … */
function chain(levels: number, prefix = 'c'): MenuNode {
  let current = node(`${prefix}${levels}`);
  for (let level = levels - 1; level >= 1; level--) current = node(`${prefix}${level}`, [current]);
  return current;
}

const tree = (): MenuNode[] => [node('a', [node('a1'), node('a2')]), node('b'), node('c')];

describe('conversion', () => {
  it('reads stored items and writes them back', () => {
    const items = [
      { label: 'Home', url: '/' },
      {
        label: 'Blog',
        entry: { uid: 'api::page', documentId: 'x1' },
        target: '_blank' as const,
        children: [{ label: 'Heading' }],
      },
    ];
    const nodes = fromItems(items);
    expect(nodes[1].link).toBe('entry');
    expect(nodes[1].children[0].link).toBe('none');
    expect(toItems(nodes)).toEqual(items);
  });

  it('trims labels and drops empty URLs, empty children and _self', () => {
    const item = { ...node('x'), label: ' X ', url: '  ', target: '_self' as const };
    expect(toItems([item])).toEqual([{ label: 'X' }]);
    expect(fromItems('nope')).toEqual([]);
  });
});

describe('flatten', () => {
  it('lists rows in display order with depth and paths', () => {
    const rows = flatten(tree());
    expect(rows.map((row) => [row.node.label, row.depth, row.path.join('.')])).toEqual([
      ['a', 1, '0'],
      ['a1', 2, '0.0'],
      ['a2', 2, '0.1'],
      ['b', 1, '1'],
      ['c', 1, '2'],
    ]);
    expect(countItems(tree())).toBe(5);
    expect(treeDepth(tree())).toBe(2);
    expect(treeDepth([])).toBe(0);
  });
});

describe('move up and down', () => {
  it('swaps siblings', () => {
    expect(shape(moveNode(tree(), 'b', -1))).toEqual(['b', { a: ['a1', 'a2'] }, 'c']);
    expect(shape(moveNode(tree(), 'a1', 1))).toEqual([{ a: ['a2', 'a1'] }, 'b', 'c']);
  });

  it('refuses to leave the list', () => {
    expect(moveNode(tree(), 'a', -1)).toBeNull();
    expect(moveNode(tree(), 'c', 1)).toBeNull();
    expect(moveNode(tree(), 'a2', 1)).toBeNull();
    expect(moveNode(tree(), 'missing', 1)).toBeNull();
  });

  it('does not mutate the input', () => {
    const input = tree();
    moveNode(input, 'b', -1);
    indent(input, 'b');
    expect(shape(input)).toEqual([{ a: ['a1', 'a2'] }, 'b', 'c']);
  });
});

describe('indent and outdent', () => {
  it('indents under the previous sibling, as its last child', () => {
    expect(canIndent(tree(), 'b')).toBe(true);
    expect(shape(indent(tree(), 'b'))).toEqual([{ a: ['a1', 'a2', 'b'] }, 'c']);
    expect(shape(indent(tree(), 'a2'))).toEqual([{ a: [{ a1: ['a2'] }] }, 'b', 'c']);
  });

  it('cannot indent the first sibling', () => {
    expect(canIndent(tree(), 'a')).toBe(false);
    expect(canIndent(tree(), 'a1')).toBe(false);
    expect(indent(tree(), 'a')).toBeNull();
  });

  it('outdents after the parent, leaving later siblings in place', () => {
    expect(canOutdent(tree(), 'a1')).toBe(true);
    expect(canOutdent(tree(), 'a')).toBe(false);
    expect(shape(outdent(tree(), 'a1'))).toEqual([{ a: ['a2'] }, 'a1', 'b', 'c']);
    expect(outdent(tree(), 'b')).toBeNull();
  });

  it('respects the depth limit, counting the moved subtree', () => {
    // x > c1 > … > c4 is 5 levels deep; y (2 levels) may still go under x.
    const deep = [node('x', [chain(MAX_MENU_DEPTH - 1)]), node('y', [node('y1')])];
    expect(treeDepth(deep)).toBe(MAX_MENU_DEPTH);
    expect(canIndent(deep, 'y')).toBe(true);
    expect(treeDepth(indent(deep, 'y')!)).toBe(MAX_MENU_DEPTH);
    // n1 > … > n5 is 5 levels: under m it would reach 6.
    const tall = [node('m'), chain(MAX_MENU_DEPTH, 'n')];
    expect(canIndent(tall, 'n1')).toBe(false);
    expect(indent(tall, 'n1')).toBeNull();
    // r becomes the last child of q1, at level 3.
    expect(canIndent([node('p', [chain(3, 'q'), node('r')])], 'r')).toBe(true);
  });
});

describe('add, update and remove', () => {
  it('adds at the top level or under a parent within the limits', () => {
    expect(shape(addNode(tree(), null, node('d')))).toEqual([{ a: ['a1', 'a2'] }, 'b', 'c', 'd']);
    expect(shape(addNode(tree(), 'b', node('b1')))).toEqual([
      { a: ['a1', 'a2'] },
      { b: ['b1'] },
      'c',
    ]);
    const deep = [chain(MAX_MENU_DEPTH)];
    expect(addNode(deep, `c${MAX_MENU_DEPTH}`, node('too-deep'))).toBeNull();
    expect(addNode(deep, `c${MAX_MENU_DEPTH - 1}`, node('fits'))).not.toBeNull();
  });

  it('refuses more than 500 items', () => {
    const many = Array.from({ length: 500 }, (_, index) => node(`n${index}`));
    expect(addNode(many, null, node('one-more'))).toBeNull();
  });

  it('updates and removes by key', () => {
    expect(updateNode(tree(), 'a2', { label: 'A2' })[0].children[1].label).toBe('A2');
    expect(shape(removeNode(tree(), 'a'))).toEqual(['b', 'c']);
    expect(shape(removeNode(tree(), 'a1'))).toEqual([{ a: ['a2'] }, 'b', 'c']);
  });
});

describe('drag and drop (moveRow)', () => {
  // Rows: 0 a, 1 a1, 2 a2, 3 b, 4 c.
  it('moving up goes before the target row, as its sibling', () => {
    expect(shape(moveRow(tree(), 4, 1))).toEqual([{ a: ['c', 'a1', 'a2'] }, 'b']);
    expect(shape(moveRow(tree(), 3, 0))).toEqual(['b', { a: ['a1', 'a2'] }, 'c']);
  });

  it('moving down goes after the target row, or first under it when it has children', () => {
    expect(shape(moveRow(tree(), 3, 4))).toEqual([{ a: ['a1', 'a2'] }, 'c', 'b']);
    expect(shape(moveRow(tree(), 1, 2))).toEqual([{ a: ['a2', 'a1'] }, 'b', 'c']);
    const nested = [node('x'), node('y', [node('y1')])];
    expect(shape(moveRow(nested, 0, 1))).toEqual([{ y: ['x', 'y1'] }]);
  });

  it('refuses to drop an item into itself, or too deep', () => {
    expect(moveRow(tree(), 0, 1)).toBeNull();
    expect(moveRow(tree(), 0, 2)).toBeNull();
    expect(moveRow(tree(), 2, 2)).toBeNull();
    const deep = [chain(MAX_MENU_DEPTH), node('z', [node('z1')])];
    // Row 4 is c5 (level 5); z (2 levels) before it would reach level 6.
    expect(moveRow(deep, 5, 4)).toBeNull();
  });
});

describe('validation', () => {
  it('checks labels and links', () => {
    expect(itemProblems({ ...node('ok'), url: '/about' })).toEqual([]);
    expect(itemProblems({ ...node('x'), label: '  ' })).toEqual(['label']);
    expect(itemProblems({ ...node('x'), label: 'x'.repeat(256) })).toEqual(['labelLength']);
    expect(itemProblems({ ...node('x'), url: 'javascript:alert(1)' })).toEqual(['url']);
    expect(itemProblems({ ...node('x'), link: 'entry', entry: null })).toEqual(['entry']);
    const problems = treeProblems([node('a', [{ ...node('bad'), label: '' }])]);
    expect([...problems.keys()]).toEqual(['bad']);
  });

  it('accepts the links the server accepts', () => {
    for (const url of ['/a', '#top', 'https://x.io', 'mailto:a@b.c', 'tel:+34600000000']) {
      expect(validMenuUrl(url)).toBe(true);
    }
    for (const url of ['about', 'ftp://x.io', 'javascript:void(0)']) {
      expect(validMenuUrl(url)).toBe(false);
    }
  });
});
