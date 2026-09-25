import type { Extensions } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import StarterKit from '@tiptap/starter-kit';

import { isSafeUrl } from './blocks-convert';

/** Images keep their media library file object (`file`) so it round-trips to the API. */
export const BlockImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      file: { default: null, rendered: false },
    };
  },
}).configure({ inline: false, allowBase64: false, resize: false });

/**
 * The TipTap schema matching Strapi's `blocks`: paragraphs, headings 1-6, lists, quotes, code
 * blocks, images; bold, italic, underline, strikethrough, inline code and links.
 */
export function blocksExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      horizontalRule: false,
      link: false,
      underline: false,
    }),
    Underline,
    Link.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      defaultProtocol: 'https',
      isAllowedUri: (url) => isSafeUrl(url),
      HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: null },
    }),
    BlockImage,
  ];
}
