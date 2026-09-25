import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import { Block, PmNode, blocksToTiptap, isSafeUrl, tiptapToBlocks } from './blocks-convert';
import { blocksExtensions } from './blocks-extensions';

const text = (value: string, flags: Record<string, boolean> = {}) => ({
  type: 'text' as const,
  text: value,
  ...flags,
});

/** blocks → TipTap → blocks. */
const roundTrip = (blocks: Block[]) => tiptapToBlocks(blocksToTiptap(blocks));

describe('blocks converters', () => {
  describe('empty documents', () => {
    it('turns null and [] into one empty paragraph', () => {
      const empty = { type: 'doc', content: [{ type: 'paragraph' }] };
      expect(blocksToTiptap(null)).toEqual(empty);
      expect(blocksToTiptap(undefined)).toEqual(empty);
      expect(blocksToTiptap([])).toEqual(empty);
    });

    it('turns an empty editor into null', () => {
      expect(tiptapToBlocks({ type: 'doc', content: [{ type: 'paragraph' }] })).toBeNull();
      expect(tiptapToBlocks({ type: 'doc', content: [] })).toBeNull();
      expect(tiptapToBlocks({ type: 'doc' })).toBeNull();
      expect(tiptapToBlocks(null)).toBeNull();
      expect(roundTrip([])).toBeNull();
      expect(roundTrip([{ type: 'paragraph', children: [text('')] }])).toBeNull();
    });
  });

  describe('round trips', () => {
    it('keeps paragraphs', () => {
      const blocks: Block[] = [
        { type: 'paragraph', children: [text('Hello world')] },
        { type: 'paragraph', children: [text('')] },
        { type: 'paragraph', children: [text('Second')] },
      ];
      expect(roundTrip(blocks)).toEqual(blocks);
    });

    it('keeps every heading level', () => {
      const blocks: Block[] = ([1, 2, 3, 4, 5, 6] as const).map((level) => ({
        type: 'heading',
        level,
        children: [text(`Level ${level}`)],
      }));
      expect(roundTrip(blocks)).toEqual(blocks);
      expect(blocksToTiptap(blocks).content?.[2]).toEqual({
        type: 'heading',
        attrs: { level: 3 },
        content: [{ type: 'text', text: 'Level 3' }],
      });
    });

    it.each(['bold', 'italic', 'underline', 'strikethrough', 'code'])(
      'keeps the %s mark',
      (mark) => {
        const blocks: Block[] = [
          {
            type: 'paragraph',
            children: [text('plain '), text('marked', { [mark]: true }), text(' end')],
          },
        ];
        expect(roundTrip(blocks)).toEqual(blocks);
      },
    );

    it('maps marks to TipTap names', () => {
      const doc = blocksToTiptap([
        {
          type: 'paragraph',
          children: [text('x', { bold: true, italic: true, underline: true, strikethrough: true })],
        },
      ]);
      expect(doc.content?.[0].content?.[0].marks).toEqual([
        { type: 'bold' },
        { type: 'italic' },
        { type: 'underline' },
        { type: 'strike' },
      ]);
    });

    it('keeps combined marks', () => {
      const blocks: Block[] = [
        {
          type: 'paragraph',
          children: [
            text('all', { bold: true, italic: true, underline: true, strikethrough: true }),
          ],
        },
      ];
      expect(roundTrip(blocks)).toEqual(blocks);
    });

    it('keeps line breaks inside text', () => {
      const blocks: Block[] = [
        { type: 'paragraph', children: [text('one\ntwo'), text('\nbold', { bold: true })] },
      ];
      expect(blocksToTiptap(blocks).content?.[0].content?.map((node) => node.type)).toEqual([
        'text',
        'hardBreak',
        'text',
        'hardBreak',
        'text',
      ]);
      expect(roundTrip(blocks)).toEqual(blocks);
    });

    it('keeps links, with formatted children', () => {
      const blocks: Block[] = [
        {
          type: 'paragraph',
          children: [
            text('See '),
            {
              type: 'link',
              url: 'https://verdin.dev',
              children: [text('the '), text('site', { bold: true })],
            },
            text(' or '),
            { type: 'link', url: '/docs', children: [text('docs')] },
          ],
        },
      ];
      expect(roundTrip(blocks)).toEqual(blocks);
      expect(blocksToTiptap(blocks).content?.[0].content?.[1]).toEqual({
        type: 'text',
        text: 'the ',
        marks: [{ type: 'link', attrs: { href: 'https://verdin.dev' } }],
      });
    });

    it('drops unsafe links, keeping their text', () => {
      expect(
        roundTrip([
          {
            type: 'paragraph',
            children: [{ type: 'link', url: 'javascript:alert(1)', children: [text('x')] }],
          },
        ]),
      ).toEqual([{ type: 'paragraph', children: [text('x')] }]);
      expect(
        tiptapToBlocks({
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'y', marks: [{ type: 'link', attrs: { href: 'data:x' } }] },
              ],
            },
          ],
        }),
      ).toEqual([{ type: 'paragraph', children: [text('y')] }]);
    });

    it('splits adjacent links with different urls', () => {
      const blocks: Block[] = [
        {
          type: 'paragraph',
          children: [
            { type: 'link', url: 'https://a.test', children: [text('a')] },
            { type: 'link', url: 'https://b.test', children: [text('b')] },
          ],
        },
      ];
      expect(roundTrip(blocks)).toEqual(blocks);
    });

    it('keeps quotes', () => {
      const blocks: Block[] = [
        { type: 'quote', children: [text('To be, '), text('or not', { italic: true })] },
      ];
      expect(roundTrip(blocks)).toEqual(blocks);
      expect(blocksToTiptap(blocks).content?.[0].type).toBe('blockquote');
    });

    it('joins the paragraphs of a quote with line breaks', () => {
      expect(
        tiptapToBlocks({
          type: 'doc',
          content: [
            {
              type: 'blockquote',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
                { type: 'paragraph', content: [{ type: 'text', text: 'two' }] },
              ],
            },
          ],
        }),
      ).toEqual([{ type: 'quote', children: [text('one\ntwo')] }]);
    });

    it('keeps code blocks and their language', () => {
      const blocks: Block[] = [
        { type: 'code', language: 'rust', children: [text('fn main() {\n    println!("hi");\n}')] },
        { type: 'code', children: [text('plain')] },
      ];
      expect(roundTrip(blocks)).toEqual(blocks);
      expect(blocksToTiptap(blocks).content?.[0]).toEqual({
        type: 'codeBlock',
        attrs: { language: 'rust' },
        content: [{ type: 'text', text: 'fn main() {\n    println!("hi");\n}' }],
      });
    });

    it('keeps an empty code block', () => {
      const blocks: Block[] = [{ type: 'code', children: [text('')] }];
      expect(blocksToTiptap(blocks).content?.[0]).toEqual({
        type: 'codeBlock',
        attrs: { language: null },
      });
      expect(roundTrip(blocks)).toEqual(blocks);
    });

    it('keeps ordered and unordered lists', () => {
      const blocks: Block[] = [
        {
          type: 'list',
          format: 'unordered',
          children: [
            { type: 'list-item', children: [text('one')] },
            { type: 'list-item', children: [text('two', { bold: true })] },
          ],
        },
        {
          type: 'list',
          format: 'ordered',
          children: [{ type: 'list-item', children: [text('first')] }],
        },
      ];
      expect(roundTrip(blocks)).toEqual(blocks);
      expect(blocksToTiptap(blocks).content?.map((node) => node.type)).toEqual([
        'bulletList',
        'orderedList',
      ]);
    });

    it('keeps nested lists', () => {
      const blocks: Block[] = [
        {
          type: 'list',
          format: 'unordered',
          children: [
            { type: 'list-item', children: [text('fruit')] },
            {
              type: 'list',
              format: 'ordered',
              indentLevel: 1,
              children: [
                { type: 'list-item', children: [text('apple')] },
                {
                  type: 'list',
                  format: 'unordered',
                  indentLevel: 2,
                  children: [{ type: 'list-item', children: [text('green')] }],
                },
                { type: 'list-item', children: [text('pear')] },
              ],
            },
            { type: 'list-item', children: [text('veg')] },
          ],
        },
      ];
      expect(roundTrip(blocks)).toEqual(blocks);
      // The nested list sits inside the preceding item, as TipTap requires.
      const firstItem = blocksToTiptap(blocks).content?.[0].content?.[0];
      expect(firstItem?.content?.map((node) => node.type)).toEqual(['paragraph', 'orderedList']);
    });

    it('gives a leading nested list an empty item', () => {
      const doc = blocksToTiptap([
        {
          type: 'list',
          format: 'unordered',
          children: [
            {
              type: 'list',
              format: 'unordered',
              children: [{ type: 'list-item', children: [text('deep')] }],
            },
          ],
        },
      ]);
      expect(doc.content?.[0].content?.[0].content?.map((node) => node.type)).toEqual([
        'paragraph',
        'bulletList',
      ]);
    });

    it('keeps links inside list items', () => {
      const blocks: Block[] = [
        {
          type: 'list',
          format: 'unordered',
          children: [
            {
              type: 'list-item',
              children: [{ type: 'link', url: 'mailto:hi@verdin.dev', children: [text('mail')] }],
            },
          ],
        },
      ];
      expect(roundTrip(blocks)).toEqual(blocks);
    });

    it('keeps images with their whole file object', () => {
      const image = {
        id: 7,
        documentId: 'f7',
        name: 'cat.png',
        url: '/uploads/cat.png',
        alternativeText: 'A cat',
        width: 800,
        height: 600,
        mime: 'image/png',
      };
      const blocks: Block[] = [
        { type: 'paragraph', children: [text('Before')] },
        { type: 'image', image, children: [text('')] },
        { type: 'paragraph', children: [text('After')] },
      ];
      expect(blocksToTiptap(blocks).content?.[1]).toEqual({
        type: 'image',
        attrs: { src: '/uploads/cat.png', alt: 'A cat', title: null, file: image },
      });
      expect(roundTrip(blocks)).toEqual(blocks);
    });

    it('reads edited alt text back into the image', () => {
      expect(
        tiptapToBlocks({
          type: 'doc',
          content: [
            {
              type: 'image',
              attrs: { src: '/uploads/a.png', alt: 'New', file: { url: '/uploads/a.png', id: 1 } },
            },
          ],
        }),
      ).toEqual([
        {
          type: 'image',
          image: { id: 1, url: '/uploads/a.png', alternativeText: 'New' },
          children: [text('')],
        },
      ]);
    });

    it('drops images without a url', () => {
      expect(blocksToTiptap([{ type: 'image', image: { url: '' }, children: [text('')] }])).toEqual(
        { type: 'doc', content: [{ type: 'paragraph' }] },
      );
    });

    it('keeps a whole mixed document', () => {
      const blocks: Block[] = [
        { type: 'heading', level: 2, children: [text('Title')] },
        {
          type: 'paragraph',
          children: [
            text('Some '),
            text('bold', { bold: true }),
            text(' and '),
            { type: 'link', url: 'tel:+34600000000', children: [text('call', { italic: true })] },
          ],
        },
        { type: 'quote', children: [text('Quote')] },
        {
          type: 'list',
          format: 'ordered',
          children: [{ type: 'list-item', children: [text('step', { code: true })] }],
        },
        { type: 'code', language: 'ts', children: [text('const x = 1;')] },
      ];
      expect(roundTrip(blocks)).toEqual(blocks);
    });
  });

  describe('editor output', () => {
    it('merges adjacent text with the same formatting', () => {
      expect(
        tiptapToBlocks({
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'a', marks: [{ type: 'bold' }] },
                { type: 'text', text: 'b', marks: [{ type: 'bold' }] },
              ],
            },
          ],
        }),
      ).toEqual([{ type: 'paragraph', children: [text('ab', { bold: true })] }]);
    });

    it('flattens paragraphs and other blocks inside list items', () => {
      expect(
        tiptapToBlocks({
          type: 'doc',
          content: [
            {
              type: 'bulletList',
              content: [
                {
                  type: 'listItem',
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
                    { type: 'paragraph', content: [{ type: 'text', text: 'b' }] },
                  ],
                },
                { type: 'listItem', content: [] },
              ],
            },
          ],
        }),
      ).toEqual([
        {
          type: 'list',
          format: 'unordered',
          children: [
            { type: 'list-item', children: [text('a')] },
            { type: 'list-item', children: [text('b')] },
            { type: 'list-item', children: [text('')] },
          ],
        },
      ]);
    });

    it('drops horizontal rules and keeps unknown text', () => {
      expect(
        tiptapToBlocks({
          type: 'doc',
          content: [
            { type: 'horizontalRule' },
            { type: 'mystery', content: [{ type: 'text', text: 'kept' }] },
          ],
        }),
      ).toEqual([{ type: 'paragraph', children: [text('kept')] }]);
    });
  });
});

describe('through the TipTap schema', () => {
  /** blocks → a real (headless) editor → blocks: the JSON must be valid for the schema. */
  const viaEditor = (blocks: Block[] | null) => {
    const editor = new Editor({ extensions: blocksExtensions(), content: blocksToTiptap(blocks) });
    try {
      return tiptapToBlocks(editor.getJSON() as PmNode);
    } finally {
      editor.destroy();
    }
  };

  it('keeps every node type and mark', () => {
    const blocks: Block[] = [
      { type: 'heading', level: 5, children: [text('Title')] },
      {
        type: 'paragraph',
        children: [
          text('a', { bold: true }),
          text('b', { italic: true }),
          text('c', { underline: true }),
          text('d', { strikethrough: true }),
          text('e', { code: true }),
          text(' line\nbreak'),
          { type: 'link', url: 'https://verdin.dev', children: [text('link')] },
        ],
      },
      { type: 'quote', children: [text('Quote')] },
      {
        type: 'list',
        format: 'unordered',
        children: [
          { type: 'list-item', children: [text('one')] },
          {
            type: 'list',
            format: 'ordered',
            indentLevel: 1,
            children: [{ type: 'list-item', children: [text('nested')] }],
          },
        ],
      },
      { type: 'code', language: 'rust', children: [text('fn main() {}')] },
      {
        type: 'image',
        image: { id: 3, url: '/uploads/a.png', alternativeText: 'Alt', width: 10, height: 20 },
        children: [text('')],
      },
    ];
    expect(viaEditor(blocks)).toEqual(blocks);
  });

  it('keeps an empty document empty', () => {
    expect(viaEditor(null)).toBeNull();
    expect(viaEditor([])).toBeNull();
  });

  it('refuses unsafe link urls', () => {
    const result = viaEditor([
      {
        type: 'paragraph',
        children: [{ type: 'link', url: 'javascript:alert(1)', children: [text('x')] }],
      },
    ]);
    expect(result).toEqual([{ type: 'paragraph', children: [text('x')] }]);
  });
});

describe('isSafeUrl', () => {
  it.each([
    'https://verdin.dev',
    'http://example.com/a?b=c',
    'HTTPS://EXAMPLE.COM',
    'mailto:hi@verdin.dev',
    'tel:+34600000000',
    '/relative/path',
    'relative',
    '#anchor',
    '?q=1',
    './here',
    '/path?x=a:b',
  ])('accepts %s', (url) => expect(isSafeUrl(url)).toBe(true));

  it.each([
    '',
    '   ',
    'javascript:alert(1)',
    ' JavaScript:alert(1)',
    'data:text/html,x',
    'vbscript:x',
    'ftp://x',
  ])('rejects %j', (url) => expect(isSafeUrl(url)).toBe(false));
});
