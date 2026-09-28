import { describe, expect, it } from 'vitest';

import {
  SPLIT_MAX,
  SPLIT_MIN,
  clampSplit,
  frameableUrl,
  splitAfterKey,
  splitAt,
} from './preview-pane';

describe('preview pane', () => {
  it('only frames http(s) URLs', () => {
    expect(frameableUrl('https://site.example/a?preview=1')).toBe(
      'https://site.example/a?preview=1',
    );
    expect(frameableUrl('http://localhost:3000/')).toBe('http://localhost:3000/');
    expect(frameableUrl('/preview/a', 'https://cms.example/admin/')).toBe(
      'https://cms.example/preview/a',
    );
    for (const url of ['javascript:alert(1)', 'data:text/html,<p>x</p>', 'blob:x', 'ftp://a/'])
      expect(frameableUrl(url, 'https://cms.example/')).toBeNull();
    expect(frameableUrl('http://[', undefined)).toBeNull();
  });

  it('splits from the inline start, in both directions', () => {
    expect(splitAt(250, 0, 1000, false)).toBe(SPLIT_MIN);
    expect(splitAt(600, 0, 1000, false)).toBe(60);
    expect(splitAt(600, 0, 1000, true)).toBe(40);
    expect(splitAt(990, 0, 1000, false)).toBe(SPLIT_MAX);
    expect(splitAt(10, 10, 10, false)).toBe(50);
    expect(clampSplit(52.4)).toBe(52);
  });

  it('moves the separator with the arrow keys (flipped right to left)', () => {
    expect(splitAfterKey(50, 'ArrowRight', false)).toBe(55);
    expect(splitAfterKey(50, 'ArrowRight', true)).toBe(45);
    expect(splitAfterKey(50, 'ArrowLeft', false)).toBe(45);
    expect(splitAfterKey(SPLIT_MAX, 'ArrowRight', false)).toBe(SPLIT_MAX);
    expect(splitAfterKey(50, 'Home', false)).toBe(SPLIT_MIN);
    expect(splitAfterKey(50, 'End', true)).toBe(SPLIT_MAX);
    expect(splitAfterKey(50, 'Enter', false)).toBeNull();
  });
});
