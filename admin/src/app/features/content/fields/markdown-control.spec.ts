import { describe, expect, it } from 'vitest';

import { renderMarkdown } from './markdown-control';

describe('renderMarkdown', () => {
  it('renders Markdown', () => {
    const html = renderMarkdown('# Title\n\nSome **bold** and `code`.\n\n- one\n- two');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<li>one</li>');
  });

  it('strips scripts, handlers and javascript: links', () => {
    const html = renderMarkdown(
      '<script>alert(1)</script><img src="x" onerror="alert(1)">\n\n[x](javascript:alert(1))',
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('javascript:');
  });

  it('opens links with rel=noopener', () => {
    const html = renderMarkdown('[site](https://verdin.dev)');
    expect(html).toContain('href="https://verdin.dev"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain('target="_blank"');
  });
});
