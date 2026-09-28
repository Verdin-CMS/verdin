import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { Api } from './api';

import {
  EntryReview,
  ReviewWorkflows,
  Workflow,
  isStageColor,
  moveItem,
  nextStageName,
  pendingPublishStage,
  toWorkflowInput,
  typesInUse,
} from './review';

function workflow(id: number, contentTypes: string[], publishStageId: number | null = null) {
  return {
    id,
    name: `W${id}`,
    contentTypes,
    publishStageId,
    stages: [
      { id: id * 10 + 1, name: 'To do', color: '#4945ff', roles: [] },
      { id: id * 10 + 2, name: 'Ready', color: '#2f9e44', roles: ['editor'] },
    ],
  } satisfies Workflow;
}

describe('review workflows', () => {
  it('builds the request body, trimming and keeping stage ids', () => {
    expect(
      toWorkflowInput(
        ' Editorial ',
        ['api::article'],
        [
          { id: 1, name: ' To do ', color: '#4945FF', roles: [] },
          { name: 'Ready', color: '#2f9e44', roles: ['editor'] },
        ],
        'Ready',
      ),
    ).toEqual({
      name: 'Editorial',
      contentTypes: ['api::article'],
      stages: [
        { id: 1, name: 'To do', color: '#4945ff', roles: [] },
        { name: 'Ready', color: '#2f9e44', roles: ['editor'] },
      ],
      publishStage: 'Ready',
    });
    expect(toWorkflowInput('W', [], [], null)).not.toHaveProperty('publishStage');
  });

  it('lists the types other workflows use', () => {
    const used = typesInUse([workflow(1, ['api::a']), workflow(2, ['api::b', 'api::c'])], 2);
    expect([...used.entries()]).toEqual([['api::a', 'W1']]);
  });

  it('moves stages within bounds', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moveItem(['a', 'b', 'c'], 2, 5)).toEqual(['a', 'b', 'c']);
  });

  it('names new stages after the unused next number', () => {
    const label = (n: number) => `Stage ${n}`;
    expect(nextStageName([{ name: 'A' }], label)).toBe('Stage 2');
    expect(nextStageName([{ name: 'stage 2' }, { name: 'B' }], label)).toBe('Stage 3');
  });

  it('checks colors', () => {
    expect(isStageColor('#4945ff')).toBe(true);
    expect(isStageColor('#ABCDEF')).toBe(true);
    expect(isStageColor('red')).toBe(false);
    expect(isStageColor('#fff')).toBe(false);
  });

  it('tells which stage publishing waits for', () => {
    const state = (stageId: number, publishStageId: number | null): EntryReview => ({
      workflow: workflow(1, ['api::a'], publishStageId),
      stageId,
      assigneeId: null,
      updatedAt: null,
      updatedBy: null,
      canMoveTo: [11, 12],
    });
    expect(pendingPublishStage(state(11, 12))?.name).toBe('Ready');
    expect(pendingPublishStage(state(12, 12))).toBeNull();
    expect(pendingPublishStage(state(11, null))).toBeNull();
    expect(pendingPublishStage(null)).toBeNull();
  });
});

describe('ReviewWorkflows', () => {
  function service(response: unknown) {
    const calls: { path: string; query?: string }[] = [];
    const api = {
      list: async (path: string, query?: string) => {
        calls.push({ path, query });
        return response;
      },
      get: async (path: string, query?: string) => {
        calls.push({ path, query });
        return response;
      },
    };
    TestBed.configureTestingModule({ providers: [{ provide: Api, useValue: api }] });
    return { review: TestBed.inject(ReviewWorkflows), calls };
  }

  it('reads list row stages and the workflow from one call', async () => {
    const flow = workflow(1, ['api::a']);
    const row = {
      uid: 'api::a',
      documentId: 'x',
      locale: 'fr',
      stageId: 12,
      assigneeId: null,
      updatedAt: null,
      updatedBy: null,
    };
    const { review, calls } = service({ data: [row], meta: { workflow: flow } });
    expect(await review.entries('api::a', ['x', 'y z'], 'fr')).toEqual({
      entries: [row],
      workflow: flow,
    });
    expect(calls).toEqual([
      { path: '/content/api::a/review', query: 'documentIds=x,y%20z&locale=fr' },
    ]);
  });

  it('treats a missing workflow as none', async () => {
    const { review } = service({ data: [], meta: {} });
    expect(await review.entries('api::a', ['x'])).toEqual({ entries: [], workflow: null });
  });

  it('asks for the assignees of a type', async () => {
    const { review, calls } = service([]);
    await review.assignees('api::a');
    expect(calls).toEqual([{ path: '/review/assignees', query: 'uid=api%3A%3Aa' }]);
  });
});
