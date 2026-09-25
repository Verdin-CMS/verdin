import { describe, expect, it } from 'vitest';

import { Block } from './fields/blocks-convert';
import {
  authorInitials,
  authorName,
  blocksToHtml,
  droppedSummary,
  editorLink,
  eventIcon,
  eventLabelKey,
} from './history-model';

const ada = { id: 1, firstname: 'Ada', lastname: 'Lovelace', email: 'ada@example.com' };

describe('eventLabelKey', () => {
  it('names every known event', () => {
    expect(eventLabelKey('entry.create')).toBe('content.history.event.create');
    expect(eventLabelKey('entry.update')).toBe('content.history.event.update');
    expect(eventLabelKey('entry.publish')).toBe('content.history.event.publish');
    expect(eventLabelKey('entry.unpublish')).toBe('content.history.event.unpublish');
    expect(eventLabelKey('entry.discard-draft')).toBe('content.history.event.discardDraft');
  });

  it('returns null for unknown events', () => {
    expect(eventLabelKey('entry.delete')).toBeNull();
    expect(eventLabelKey('toString')).toBeNull();
  });
});

describe('eventIcon', () => {
  it('falls back to the save icon', () => {
    expect(eventIcon('entry.publish')).toBe('lucideSend');
    expect(eventIcon('entry.update')).toBe('lucideSave');
    expect(eventIcon('something.else')).toBe('lucideSave');
  });
});

describe('authorName', () => {
  it('joins first and last name', () => {
    expect(authorName(ada)).toBe('Ada Lovelace');
    expect(authorName({ ...ada, lastname: null })).toBe('Ada');
    expect(authorName({ ...ada, firstname: '  ', lastname: 'Lovelace ' })).toBe('Lovelace');
  });

  it('falls back to the email, then the id', () => {
    expect(authorName({ ...ada, firstname: null, lastname: '' })).toBe('ada@example.com');
    expect(authorName({ id: 7, firstname: null, lastname: null, email: null })).toBe('#7');
  });

  it('is null for API changes', () => {
    expect(authorName(null)).toBeNull();
    expect(authorName(undefined)).toBeNull();
  });
});

describe('authorInitials', () => {
  it('uses first and last name', () => {
    expect(authorInitials(ada)).toBe('AL');
    expect(authorInitials({ ...ada, lastname: null })).toBe('AD');
    expect(authorInitials({ ...ada, firstname: null, lastname: null })).toBe('AD');
    expect(authorInitials({ id: 2, firstname: null, lastname: null, email: null })).toBe('?');
    expect(authorInitials(null)).toBeNull();
  });
});

describe('droppedSummary', () => {
  it('totals the counts and lists the fields', () => {
    expect(
      droppedSummary(
        [
          { field: 'tags', count: 2 },
          { field: 'cover', count: 1 },
          { field: 'empty', count: 0 },
        ],
        (field) => field.toUpperCase(),
      ),
    ).toEqual({ count: 3, fields: 'TAGS (2), COVER (1)' });
  });

  it('is empty without drops', () => {
    expect(droppedSummary([])).toEqual({ count: 0, fields: '' });
  });
});

describe('editorLink', () => {
  it('points at the collection editor or the single type', () => {
    expect(editorLink('collectionType', 'api::a.a', 'd1')).toEqual(['/content', 'api::a.a', 'd1']);
    expect(editorLink('singleType', 'api::home.home', 'd2')).toEqual(['/single', 'api::home.home']);
  });
});

describe('blocksToHtml', () => {
  it('renders paragraphs, headings, marks and links', () => {
    const blocks: Block[] = [
      { type: 'heading', level: 2, children: [{ type: 'text', text: 'Title' }] },
      {
        type: 'paragraph',
        children: [
          { type: 'text', text: 'Hi ', bold: true },
          { type: 'link', url: 'https://example.com', children: [{ type: 'text', text: 'site' }] },
        ],
      },
    ];
    expect(blocksToHtml(blocks)).toBe(
      '<h2>Title</h2><p><strong>Hi </strong><a href="https://example.com" target="_blank" rel="noopener noreferrer nofollow">site</a></p>',
    );
  });

  it('escapes text and drops unsafe links', () => {
    const blocks: Block[] = [
      {
        type: 'paragraph',
        children: [
          { type: 'text', text: '<script>alert(1)</script>' },
          { type: 'link', url: 'javascript:alert(1)', children: [{ type: 'text', text: 'x' }] },
        ],
      },
    ];
    expect(blocksToHtml(blocks)).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;x</p>');
  });

  it('renders nested lists, quotes, code and images', () => {
    const blocks: Block[] = [
      {
        type: 'list',
        format: 'ordered',
        children: [
          { type: 'list-item', children: [{ type: 'text', text: 'one' }] },
          {
            type: 'list',
            format: 'unordered',
            children: [{ type: 'list-item', children: [{ type: 'text', text: 'two' }] }],
          },
        ],
      },
      { type: 'quote', children: [{ type: 'text', text: 'q' }] },
      { type: 'code', children: [{ type: 'text', text: 'a < b' }] },
      {
        type: 'image',
        image: { url: '/uploads/a.png', alternativeText: 'A "pic"' },
        children: [{ type: 'text', text: '' }],
      },
    ];
    expect(blocksToHtml(blocks, (url) => `https://cdn${url}`)).toBe(
      '<ol><li>one</li><ul><li>two</li></ul></ol><blockquote>q</blockquote>' +
        '<pre><code>a &lt; b</code></pre>' +
        '<p><img src="https://cdn/uploads/a.png" alt="A &quot;pic&quot;"></p>',
    );
  });

  it('is empty for non-arrays', () => {
    expect(blocksToHtml(null)).toBe('');
    expect(blocksToHtml(undefined)).toBe('');
  });
});
