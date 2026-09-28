import { describe, expect, it } from 'vitest';

import { attachmentName } from './api';

describe('attachmentName', () => {
  it('reads the quoted, plain and encoded forms', () => {
    expect(attachmentName('attachment; filename="articles-2026-09-29.csv"')).toBe(
      'articles-2026-09-29.csv',
    );
    expect(attachmentName('attachment; filename=export.json')).toBe('export.json');
    expect(
      attachmentName(`attachment; filename="fallback.csv"; filename*=UTF-8''caf%C3%A9.csv`),
    ).toBe('café.csv');
  });

  it('has nothing without a header or a name', () => {
    expect(attachmentName(null)).toBeNull();
    expect(attachmentName('attachment')).toBeNull();
  });
});
