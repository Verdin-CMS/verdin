import { describe, expect, it } from 'vitest';

import {
  EMPTY_AUDIT_FILTERS,
  actionCategory,
  auditQuery,
  dayBoundary,
  hasAuditFilters,
} from './audit';

describe('audit log queries', () => {
  it('sends only the filters that are set', () => {
    expect(auditQuery(EMPTY_AUDIT_FILTERS, 1, 50)).toBe('page=1&pageSize=50');
    const query = new URLSearchParams(
      auditQuery(
        { action: ' entry.* ', actor: '3', subject: 'api::article', from: '', to: '' },
        2,
        20,
      ),
    );
    expect(Object.fromEntries(query)).toEqual({
      page: '2',
      pageSize: '20',
      action: 'entry.*',
      actor: '3',
      subject: 'api::article',
    });
  });

  it('ignores an actor that is not an id', () => {
    const query = new URLSearchParams(auditQuery({ ...EMPTY_AUDIT_FILTERS, actor: 'ada' }, 1, 50));
    expect(query.has('actor')).toBe(false);
  });

  it('turns local days into instants covering the whole day', () => {
    const from = dayBoundary('2026-09-01', false)!;
    const to = dayBoundary('2026-09-30', true)!;
    expect(new Date(from).getTime()).toBe(new Date(2026, 8, 1).getTime());
    expect(new Date(to).getTime()).toBe(new Date(2026, 8, 30, 23, 59, 59, 999).getTime());
    expect(dayBoundary('yesterday', false)).toBeNull();
    const query = new URLSearchParams(
      auditQuery({ ...EMPTY_AUDIT_FILTERS, from: '2026-09-01', to: '2026-09-30' }, 1, 50),
    );
    expect(query.get('from')).toBe(from);
    expect(query.get('to')).toBe(to);
  });

  it('knows when filters are set', () => {
    expect(hasAuditFilters(EMPTY_AUDIT_FILTERS)).toBe(false);
    expect(hasAuditFilters({ ...EMPTY_AUDIT_FILTERS, subject: 'x' })).toBe(true);
    expect(hasAuditFilters({ ...EMPTY_AUDIT_FILTERS, action: '  ' })).toBe(false);
  });

  it('names action categories', () => {
    expect(actionCategory('entry.publish')).toBe('entry');
    expect(actionCategory('admin.login')).toBe('admin');
    expect(actionCategory('PUT /roles/{id}')).toBe('PUT');
  });
});
