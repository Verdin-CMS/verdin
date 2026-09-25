/**
 * Pure converters between Strapi's `blocks` JSON (what the API stores) and TipTap's
 * ProseMirror JSON (what the editor edits). No DOM, no editor instance: unit-testable.
 */

/** Inline formatting flags of a text node. */
export const TEXT_MARKS = ['bold', 'italic', 'underline', 'strikethrough', 'code'] as const;
export type TextMark = (typeof TEXT_MARKS)[number];

export interface TextNode {
  type: 'text';
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  code?: boolean;
}

export interface LinkNode {
  type: 'link';
  url: string;
  children: TextNode[];
}

export type InlineNode = TextNode | LinkNode;

export interface ParagraphBlock {
  type: 'paragraph';
  children: InlineNode[];
}

export interface HeadingBlock {
  type: 'heading';
  level: 1 | 2 | 3 | 4 | 5 | 6;
  children: InlineNode[];
}

export interface ListItemBlock {
  type: 'list-item';
  children: InlineNode[];
}

export interface ListBlock {
  type: 'list';
  format: 'ordered' | 'unordered';
  indentLevel?: number;
  children: (ListItemBlock | ListBlock)[];
}

export interface QuoteBlock {
  type: 'quote';
  children: InlineNode[];
}

export interface CodeBlock {
  type: 'code';
  language?: string | null;
  children: TextNode[];
}

/** The image is the media library file object (url, alternativeText, width, height…). */
export interface BlockImage {
  url: string;
  alternativeText?: string | null;
  width?: number | null;
  height?: number | null;
  [key: string]: unknown;
}

export interface ImageBlock {
  type: 'image';
  image: BlockImage;
  children: TextNode[];
}

export type Block = ParagraphBlock | HeadingBlock | ListBlock | QuoteBlock | CodeBlock | ImageBlock;

/** ProseMirror JSON, as TipTap's `getJSON()` / `setContent()` use it. */
export interface PmMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface PmNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PmNode[];
  marks?: PmMark[];
  text?: string;
}

/** Strapi mark flag → TipTap mark name. */
const MARK_NAMES: Record<TextMark, string> = {
  bold: 'bold',
  italic: 'italic',
  underline: 'underline',
  strikethrough: 'strike',
  code: 'code',
};

/**
 * Whether a link URL is safe to store: http(s), mailto, tel, or relative — the server's rule
 * (no `javascript:`, `data:`…).
 */
export function isSafeUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  const colon = trimmed.indexOf(':');
  if (colon < 0) return true;
  const scheme = trimmed.slice(0, colon);
  if (/[/?#]/.test(scheme)) return true;
  return ['http', 'https', 'mailto', 'tel'].includes(scheme.toLowerCase());
}

// ---------------------------------------------------------------------------------------------
// blocks → TipTap
// ---------------------------------------------------------------------------------------------

/** Strapi blocks (or `null`) → a TipTap document. An empty value is one empty paragraph. */
export function blocksToTiptap(blocks: readonly Block[] | null | undefined): PmNode {
  const content = (Array.isArray(blocks) ? blocks : []).flatMap((block) => blockToPm(block));
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}

function withContent(node: PmNode, content: PmNode[]): PmNode {
  return content.length ? { ...node, content } : node;
}

function blockToPm(block: Block): PmNode[] {
  switch (block?.type) {
    case 'paragraph':
      return [withContent({ type: 'paragraph' }, inlineToPm(block.children))];
    case 'heading':
      return [
        withContent(
          { type: 'heading', attrs: { level: clampLevel(block.level) } },
          inlineToPm(block.children),
        ),
      ];
    case 'quote':
      return [
        {
          type: 'blockquote',
          content: [withContent({ type: 'paragraph' }, inlineToPm(block.children))],
        },
      ];
    case 'code': {
      const text = (block.children ?? []).map((child) => child?.text ?? '').join('');
      return [
        withContent(
          { type: 'codeBlock', attrs: { language: block.language ?? null } },
          text ? [{ type: 'text', text }] : [],
        ),
      ];
    }
    case 'list':
      return [listToPm(block)];
    case 'image':
      if (!block.image?.url) return [];
      return [
        {
          type: 'image',
          attrs: {
            src: block.image.url,
            alt: block.image.alternativeText ?? null,
            title: null,
            file: block.image,
          },
        },
      ];
    default: {
      // Unknown block: keep its text as a paragraph rather than dropping it.
      const children = (block as { children?: InlineNode[] } | null)?.children;
      return [withContent({ type: 'paragraph' }, inlineToPm(children ?? []))];
    }
  }
}

function clampLevel(level: unknown): number {
  const value = Number(level);
  return Number.isInteger(value) && value >= 1 && value <= 6 ? value : 1;
}

function listToPm(list: ListBlock): PmNode {
  const items: PmNode[] = [];
  for (const child of list.children ?? []) {
    if (child?.type === 'list') {
      // A nested list belongs to the preceding item (or a new empty one).
      let previous = items[items.length - 1];
      if (!previous) {
        previous = { type: 'listItem', content: [{ type: 'paragraph' }] };
        items.push(previous);
      }
      previous.content = [...(previous.content ?? []), listToPm(child)];
    } else {
      items.push({
        type: 'listItem',
        content: [withContent({ type: 'paragraph' }, inlineToPm(child?.children ?? []))],
      });
    }
  }
  if (!items.length) items.push({ type: 'listItem', content: [{ type: 'paragraph' }] });
  return { type: list.format === 'ordered' ? 'orderedList' : 'bulletList', content: items };
}

function inlineToPm(children: readonly InlineNode[] | undefined): PmNode[] {
  const nodes: PmNode[] = [];
  for (const child of children ?? []) {
    if (child?.type === 'link') {
      for (const text of child.children ?? []) {
        // Unsafe links (javascript:, data:…) keep their text but lose the link.
        const link: PmMark[] = isSafeUrl(String(child.url ?? ''))
          ? [{ type: 'link', attrs: { href: child.url } }]
          : [];
        nodes.push(...textToPm(text, link));
      }
    } else if (child?.type === 'text') {
      nodes.push(...textToPm(child, []));
    }
  }
  return nodes;
}

/** A text node → TipTap text nodes; `\n` becomes a hard break (empty text is dropped). */
function textToPm(node: TextNode, extra: PmMark[]): PmNode[] {
  const marks: PmMark[] = [
    ...TEXT_MARKS.filter((mark) => node[mark] === true).map((mark) => ({ type: MARK_NAMES[mark] })),
    ...extra,
  ];
  const nodes: PmNode[] = [];
  String(node.text ?? '')
    .split('\n')
    .forEach((part, index) => {
      if (index > 0)
        nodes.push(marks.length ? { type: 'hardBreak', marks } : { type: 'hardBreak' });
      if (part)
        nodes.push(
          marks.length ? { type: 'text', text: part, marks } : { type: 'text', text: part },
        );
    });
  return nodes;
}

// ---------------------------------------------------------------------------------------------
// TipTap → blocks
// ---------------------------------------------------------------------------------------------

/** A TipTap document → Strapi blocks; an empty document is `null`. */
export function tiptapToBlocks(doc: PmNode | null | undefined): Block[] | null {
  const blocks = (doc?.content ?? []).flatMap((node) => pmToBlocks(node));
  const empty = blocks.every(
    (block) =>
      block.type === 'paragraph' && block.children.every((c) => c.type === 'text' && !c.text),
  );
  return empty ? null : blocks;
}

function pmToBlocks(node: PmNode): Block[] {
  switch (node.type) {
    case 'paragraph':
      return [{ type: 'paragraph', children: pmToInline(node.content) }];
    case 'heading':
      return [
        {
          type: 'heading',
          level: clampLevel(node.attrs?.['level']) as HeadingBlock['level'],
          children: pmToInline(node.content),
        },
      ];
    case 'blockquote': {
      // Strapi quotes hold inline content: paragraphs are joined by line breaks.
      const inline: PmNode[] = [];
      for (const [index, child] of flattenToTextBlocks(node.content).entries()) {
        if (index > 0) inline.push({ type: 'hardBreak' });
        inline.push(...(child.content ?? []));
      }
      return [{ type: 'quote', children: pmToInline(inline) }];
    }
    case 'codeBlock': {
      const text = (node.content ?? []).map((child) => child.text ?? '').join('');
      const language = node.attrs?.['language'];
      const block: CodeBlock = { type: 'code', children: [{ type: 'text', text }] };
      if (typeof language === 'string' && language) block.language = language;
      return [block];
    }
    case 'bulletList':
    case 'orderedList':
      return [pmToList(node, 0)];
    case 'image': {
      const attrs = node.attrs ?? {};
      const file = (attrs['file'] ?? {}) as Record<string, unknown>;
      const src = String(attrs['src'] ?? file['url'] ?? '');
      if (!src) return [];
      const image: BlockImage = {
        ...file,
        url: src,
        alternativeText:
          (attrs['alt'] as string | null) ?? (file['alternativeText'] as string | null) ?? null,
      };
      return [{ type: 'image', image, children: [{ type: 'text', text: '' }] }];
    }
    case 'horizontalRule':
      return [];
    default:
      // Anything else with inline content keeps its text as a paragraph.
      return flattenToTextBlocks([node]).map((child) => ({
        type: 'paragraph',
        children: pmToInline(child.content),
      }));
  }
}

/** Textblocks (paragraph-like nodes with inline content) inside `nodes`, in order. */
function flattenToTextBlocks(nodes: PmNode[] | undefined): PmNode[] {
  const result: PmNode[] = [];
  for (const node of nodes ?? []) {
    const content = node.content ?? [];
    const inline = content.length === 0 || content.some((child) => isInline(child));
    if (node.type === 'codeBlock' || (inline && !isContainer(node))) result.push(node);
    else result.push(...flattenToTextBlocks(content));
  }
  return result;
}

function isInline(node: PmNode): boolean {
  return node.type === 'text' || node.type === 'hardBreak';
}

function isContainer(node: PmNode): boolean {
  return ['blockquote', 'bulletList', 'orderedList', 'listItem', 'doc'].includes(node.type);
}

function pmToList(node: PmNode, depth: number): ListBlock {
  const children: (ListItemBlock | ListBlock)[] = [];
  for (const item of node.content ?? []) {
    let hasItem = false;
    for (const child of item.content ?? []) {
      if (child.type === 'bulletList' || child.type === 'orderedList') {
        if (!hasItem) children.push({ type: 'list-item', children: pmToInline([]) });
        hasItem = true;
        children.push(pmToList(child, depth + 1));
      } else {
        for (const text of flattenToTextBlocks([child])) {
          children.push({ type: 'list-item', children: pmToInline(text.content) });
          hasItem = true;
        }
      }
    }
    if (!hasItem) children.push({ type: 'list-item', children: pmToInline([]) });
  }
  const list: ListBlock = {
    type: 'list',
    format: node.type === 'orderedList' ? 'ordered' : 'unordered',
    children,
  };
  if (depth > 0) list.indentLevel = depth;
  return list;
}

/** TipTap inline nodes → Strapi inline nodes: marks become flags, link marks become links. */
function pmToInline(nodes: PmNode[] | undefined): InlineNode[] {
  const result: InlineNode[] = [];
  for (const node of nodes ?? []) {
    let text: string;
    let marks: PmMark[] = [];
    if (node.type === 'text') {
      text = node.text ?? '';
      marks = node.marks ?? [];
    } else if (node.type === 'hardBreak') {
      text = '\n';
      marks = node.marks ?? [];
    } else {
      continue;
    }
    const textNode: TextNode = { type: 'text', text };
    for (const mark of TEXT_MARKS) {
      if (marks.some((candidate) => candidate.type === MARK_NAMES[mark])) textNode[mark] = true;
    }
    const link = marks.find((mark) => mark.type === 'link');
    const url = link ? String(link.attrs?.['href'] ?? '') : '';
    const href = link && isSafeUrl(url) ? url : null;
    const last = result[result.length - 1];
    if (href !== null) {
      if (last?.type === 'link' && last.url === href) appendText(last.children, textNode);
      else result.push({ type: 'link', url: href, children: [textNode] });
    } else if (last?.type === 'text') {
      appendText(result as TextNode[], textNode);
    } else {
      result.push(textNode);
    }
  }
  return result.length ? result : [{ type: 'text', text: '' }];
}

/** Appends a text node, merging it into the last one when the formatting is the same. */
function appendText(list: TextNode[], node: TextNode): void {
  const last = list[list.length - 1];
  if (last && last.type === 'text' && TEXT_MARKS.every((mark) => !!last[mark] === !!node[mark])) {
    last.text += node.text;
  } else {
    list.push(node);
  }
}
