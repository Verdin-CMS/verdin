// Prefixes root-relative links in Markdown (`/guides/sso/`) with the site's base path,
// so pages are written without it and still work under GitHub Pages' `/verdin/`.
// Runs before starlight-links-validator, which then checks the final URLs.
import { defineHastPlugin } from 'satteri';

export function baseLinks(base) {
  const prefix = base.replace(/\/+$/, '');
  const fix = (href) =>
    prefix && href.startsWith('/') && !href.startsWith('//') && href !== prefix && !href.startsWith(`${prefix}/`)
      ? `${prefix}${href}`
      : href;
  return () =>
    defineHastPlugin({
      name: 'verdin-base-links',
      // `<LinkCard href="/…">` and other MDX components with an `href` string.
      mdxJsxFlowElement: {
        filter: [],
        visit(node, ctx) {
          for (const attribute of node.attributes ?? []) {
            if (attribute.type === 'mdxJsxAttribute' && attribute.name === 'href' && typeof attribute.value === 'string') {
              const next = fix(attribute.value);
              if (next !== attribute.value) ctx.setProperty(node, 'href', next);
            }
          }
        },
      },
      element: {
        filter: [],
        visit(node, ctx) {
          if (node.tagName !== 'a') return;
          const href = node.properties?.href;
          if (typeof href === 'string' && fix(href) !== href) ctx.setProperty(node, 'href', fix(href));
        },
      },
    });
}
