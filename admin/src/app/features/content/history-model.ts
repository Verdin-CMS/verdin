/** Content history: shapes of `/history` responses and pure helpers for the history page. */
import { MessageKey } from '../../core/i18n/keys';
import {
  Block,
  InlineNode,
  ListBlock,
  ListItemBlock,
  TextNode,
  isSafeUrl,
} from './fields/blocks-convert';

export type HistoryEvent =
  'entry.create' | 'entry.update' | 'entry.publish' | 'entry.unpublish' | 'entry.discard-draft';

export interface VersionAuthor {
  id: number;
  firstname: string | null;
  lastname: string | null;
  email: string | null;
}

/** One saved version, as `GET /history/{uid}/{documentId}` lists it. */
export interface Version {
  id: number;
  uid: string;
  documentId: string;
  event: HistoryEvent | string;
  status: 'draft' | 'published';
  createdAt: string;
  createdBy: VersionAuthor | null;
}

/** A version with its document snapshot (`GET /history/versions/{id}`). */
export interface VersionDetail extends Version {
  data: Record<string, unknown>;
  /** Snapshot fields that are no longer in the schema. */
  unknownFields: string[];
}

/** References to deleted documents or files that a restore left out. */
export interface DroppedReference {
  field: string;
  count: number;
}

export interface RestoreResult {
  documentId: string;
  restored: number | boolean;
  dropped: DroppedReference[];
}

const EVENT_LABELS: Record<HistoryEvent, MessageKey> = {
  'entry.create': 'content.history.event.create',
  'entry.update': 'content.history.event.update',
  'entry.publish': 'content.history.event.publish',
  'entry.unpublish': 'content.history.event.unpublish',
  'entry.discard-draft': 'content.history.event.discardDraft',
};

/** The message key naming a version's event; `null` for events this admin does not know. */
export function eventLabelKey(event: string): MessageKey | null {
  return Object.hasOwn(EVENT_LABELS, event) ? EVENT_LABELS[event as HistoryEvent] : null;
}

/** Icon per event, for the version list. */
export function eventIcon(event: string): string {
  switch (event) {
    case 'entry.create':
      return 'lucidePlus';
    case 'entry.publish':
      return 'lucideSend';
    case 'entry.unpublish':
      return 'lucideEyeOff';
    case 'entry.discard-draft':
      return 'lucideUndo2';
    default:
      return 'lucideSave';
  }
}

/** "Ada Lovelace", else the email; `null` when no admin made the change (the content API). */
export function authorName(author: VersionAuthor | null | undefined): string | null {
  if (!author) return null;
  const name = [author.firstname, author.lastname]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(' ');
  return name || author.email?.trim() || `#${author.id}`;
}

/** Initials for the author's avatar ("AL"); `null` for API changes. */
export function authorInitials(author: VersionAuthor | null | undefined): string | null {
  if (!author) return null;
  const parts = [author.firstname, author.lastname]
    .map((part) => (part ?? '').trim())
    .filter(Boolean);
  const source = parts.length ? parts : [(author.email ?? '').trim()].filter(Boolean);
  if (!source.length) return '?';
  const letters =
    source.length > 1 ? source[0][0] + source[source.length - 1][0] : source[0].slice(0, 2);
  return letters.toLocaleUpperCase();
}

/** `[{field: 'tags', count: 2}]` → `tags (2)`, with field labels from `label`. */
export function droppedSummary(
  dropped: readonly DroppedReference[],
  label: (field: string) => string = (field) => field,
): { count: number; fields: string } {
  const useful = dropped.filter((entry) => entry.count > 0);
  return {
    count: useful.reduce((total, entry) => total + entry.count, 0),
    fields: useful.map((entry) => `${label(entry.field)} (${entry.count})`).join(', '),
  };
}

/** Where the editor of a document lives. */
export function editorLink(kind: 'collectionType' | 'singleType', uid: string, documentId: string) {
  return kind === 'singleType' ? ['/single', uid] : ['/content', uid, documentId];
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

function textHtml(node: TextNode): string {
  let html = escapeHtml(node.text ?? '').replace(/\n/g, '<br>');
  if (node.code) html = `<code>${html}</code>`;
  if (node.bold) html = `<strong>${html}</strong>`;
  if (node.italic) html = `<em>${html}</em>`;
  if (node.underline) html = `<u>${html}</u>`;
  if (node.strikethrough) html = `<s>${html}</s>`;
  return html;
}

function inlineHtml(nodes: readonly InlineNode[] | undefined): string {
  return (nodes ?? [])
    .map((node) => {
      if (node.type === 'link') {
        const inner = (node.children ?? []).map(textHtml).join('');
        return isSafeUrl(node.url ?? '')
          ? `<a href="${escapeHtml(node.url)}" target="_blank" rel="noopener noreferrer nofollow">${inner}</a>`
          : inner;
      }
      return textHtml(node);
    })
    .join('');
}

function listHtml(list: ListBlock): string {
  const tag = list.format === 'ordered' ? 'ol' : 'ul';
  const items = (list.children ?? [])
    .map((child) =>
      child.type === 'list'
        ? listHtml(child)
        : `<li>${inlineHtml((child as ListItemBlock).children)}</li>`,
    )
    .join('');
  return `<${tag}>${items}</${tag}>`;
}

/**
 * Strapi `blocks` JSON → HTML for a read-only view. Every text is escaped and only safe link
 * URLs are kept, so the result needs no further sanitizing (Angular sanitizes it anyway).
 */
export function blocksToHtml(
  blocks: readonly Block[] | null | undefined,
  resolveUrl: (url: string) => string = (url) => url,
): string {
  if (!Array.isArray(blocks)) return '';
  return blocks
    .map((block) => {
      switch (block.type) {
        case 'paragraph':
          return `<p>${inlineHtml(block.children)}</p>`;
        case 'heading': {
          const level = Math.min(Math.max(Number(block.level) || 1, 1), 6);
          return `<h${level}>${inlineHtml(block.children)}</h${level}>`;
        }
        case 'list':
          return listHtml(block);
        case 'quote':
          return `<blockquote>${inlineHtml(block.children)}</blockquote>`;
        case 'code':
          return `<pre><code>${escapeHtml((block.children ?? []).map((child: TextNode) => child.text ?? '').join(''))}</code></pre>`;
        case 'image': {
          const url = block.image?.url ?? '';
          if (!url || !isSafeUrl(url)) return '';
          const alt = block.image.alternativeText ?? '';
          return `<p><img src="${escapeHtml(resolveUrl(url))}" alt="${escapeHtml(alt)}"></p>`;
        }
        default:
          return '';
      }
    })
    .join('');
}
