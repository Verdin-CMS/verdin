import { describe, expect, it } from 'vitest';

import {
  AdminSession,
  describeUserAgent,
  localLink,
  passwordProblem,
  sortSessions,
} from './account';

const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0';
const EDGE_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0';
const HEADLESS =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0.0.0 Safari/537.36';

describe('account helpers', () => {
  it('reads the browser and system of a user agent', () => {
    expect(describeUserAgent(CHROME_MAC)).toEqual({
      browser: 'Chrome',
      os: 'macOS',
      mobile: false,
    });
    expect(describeUserAgent(SAFARI_IPHONE)).toEqual({
      browser: 'Safari',
      os: 'iOS',
      mobile: true,
    });
    expect(describeUserAgent(FIREFOX_LINUX)).toEqual({
      browser: 'Firefox',
      os: 'Linux',
      mobile: false,
    });
    expect(describeUserAgent(EDGE_WINDOWS).browser).toBe('Edge');
    expect(describeUserAgent(HEADLESS).browser).toBe('Chrome');
    expect(describeUserAgent(null)).toEqual({ browser: null, os: null, mobile: false });
    expect(describeUserAgent('curl/8.6.0').browser).toBe('curl');
  });

  it('checks new passwords', () => {
    expect(passwordProblem('short', 'short')).toBe('short');
    expect(passwordProblem('x'.repeat(129), 'x'.repeat(129))).toBe('long');
    expect(passwordProblem('long enough', 'long enougH')).toBe('mismatch');
    expect(passwordProblem('long enough', 'long enough')).toBeNull();
  });

  it('lists this device first, then by last use', () => {
    const session = (id: string, lastUsedAt: string, current = false): AdminSession => ({
      id,
      userAgent: null,
      createdAt: lastUsedAt,
      lastUsedAt,
      expiresAt: lastUsedAt,
      current,
    });
    const sorted = sortSessions([
      session('old', '2026-01-01T00:00:00Z'),
      session('new', '2026-03-01T00:00:00Z'),
      session('this', '2025-01-01T00:00:00Z', true),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(['this', 'new', 'old']);
  });

  it('opens invitation links on the current origin', () => {
    expect(
      localLink(
        'https://cms.example.com/admin/auth/accept-invitation?token=abc',
        'http://127.0.0.1:1337',
      ),
    ).toBe('http://127.0.0.1:1337/admin/auth/accept-invitation?token=abc');
    expect(localLink('not a url', 'http://localhost')).toBe('not a url');
  });
});
