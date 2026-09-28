import { describe, expect, it } from 'vitest';

import { EntryStage } from '../../core/review';
import { groupAssigned } from './assigned-review';

const entry = (uid: string, documentId: string, locale = ''): EntryStage => ({
  uid,
  documentId,
  locale,
  stageId: 1,
  assigneeId: 7,
  updatedAt: null,
  updatedBy: null,
});

describe('assigned entries', () => {
  it('groups them by type and locale', () => {
    const groups = groupAssigned([
      entry('api::a', '1'),
      entry('api::b', '2', 'fr'),
      entry('api::a', '3'),
      entry('api::b', '4', 'en'),
    ]);
    expect([...groups.keys()]).toEqual(['api::a|', 'api::b|fr', 'api::b|en']);
    expect(groups.get('api::a|')!.map((item) => item.documentId)).toEqual(['1', '3']);
  });
});
