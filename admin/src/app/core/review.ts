import { Injectable, inject } from '@angular/core';

import { Api } from './api';

/** A stage of a review workflow. */
export interface ReviewStage {
  id: number;
  name: string;
  /** `#rrggbb`. */
  color: string;
  /** Role codes allowed to move entries into the stage (empty: anyone who may update). */
  roles: string[];
}

export interface Workflow {
  id: number;
  name: string;
  contentTypes: string[];
  /** Entries must be in this stage to be published. */
  publishStageId: number | null;
  stages: ReviewStage[];
}

export interface StageInput {
  /** Existing stages keep their id, and their entries. */
  id?: number;
  name: string;
  color: string;
  roles: string[];
}

export interface WorkflowInput {
  name: string;
  contentTypes: string[];
  stages: StageInput[];
  /** The name of the stage required to publish. */
  publishStage?: string;
}

/** Where one entry stands (list rows and assignments). */
export interface EntryStage {
  uid: string;
  documentId: string;
  /** Empty for types that are not localized. */
  locale: string;
  stageId: number;
  assigneeId: number | null;
  updatedAt: string | null;
  updatedBy: number | null;
}

/** An entry's review state, as the editor sees it. */
export interface EntryReview {
  workflow: Workflow;
  stageId: number;
  assigneeId: number | null;
  updatedAt: string | null;
  updatedBy: number | null;
  /** Stages the caller may move the entry to (empty when they cannot update it). */
  canMoveTo: number[];
}

/** Stages of list rows, with the type's workflow (`null`: none). */
export interface EntryStages {
  entries: EntryStage[];
  workflow: Workflow | null;
}

/** An admin who can be assigned entries of a type. */
export interface Assignee {
  id: number;
  email: string;
  firstname: string | null;
  lastname: string | null;
}

/** A role that stages can be restricted to. */
export interface StageRole {
  id: number;
  code: string;
  name: string;
}

export interface EntryReviewChange {
  stageId?: number;
  /** `null` removes the assignee. */
  assigneeId?: number | null;
}

/** The default color of new stages (the server's default too). */
export const DEFAULT_STAGE_COLOR = '#4945ff';

/** Colors offered for new stages, in order. */
export const STAGE_COLORS = ['#4945ff', '#f59f00', '#2f9e44', '#e03131', '#0c8599', '#9c36b5'];

export function isStageColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

export function stageOf(workflow: Workflow | null | undefined, id: number | null | undefined) {
  return workflow?.stages.find((stage) => stage.id === id) ?? null;
}

/**
 * The stage an entry must reach before it can be published, when it is not there yet
 * (`null`: publishing is not held back by the workflow).
 */
export function pendingPublishStage(review: EntryReview | null): ReviewStage | null {
  if (!review || review.workflow.publishStageId === null) return null;
  if (review.stageId === review.workflow.publishStageId) return null;
  return stageOf(review.workflow, review.workflow.publishStageId);
}

/** The body `POST`/`PUT /review-workflows` expects for an edited workflow. */
export function toWorkflowInput(
  name: string,
  contentTypes: string[],
  stages: StageInput[],
  publishStage: string | null,
): WorkflowInput {
  const input: WorkflowInput = {
    name: name.trim(),
    contentTypes: [...contentTypes],
    stages: stages.map((stage) => {
      const item: StageInput = {
        name: stage.name.trim(),
        color: stage.color.toLowerCase(),
        roles: [...stage.roles],
      };
      if (stage.id !== undefined) item.id = stage.id;
      return item;
    }),
  };
  const publish = publishStage?.trim();
  if (publish) input.publishStage = publish;
  return input;
}

/** Content types used by workflows other than `except`, with the workflow's name. */
export function typesInUse(workflows: Workflow[], except: number | null): Map<string, string> {
  const used = new Map<string, string>();
  for (const workflow of workflows) {
    if (workflow.id === except) continue;
    for (const uid of workflow.contentTypes) used.set(uid, workflow.name);
  }
  return used;
}

/** A copy of `items` with the item at `index` moved by `delta` (clamped to the bounds). */
export function moveItem<T>(items: readonly T[], index: number, delta: number): T[] {
  const target = Math.min(items.length - 1, Math.max(0, index + delta));
  const copy = [...items];
  if (index < 0 || index >= copy.length || target === index) return copy;
  const [item] = copy.splice(index, 1);
  copy.splice(target, 0, item);
  return copy;
}

/** A stage name not used yet in `stages` ("Stage 3", "Stage 4"…). */
export function nextStageName(stages: readonly { name: string }[], label: (n: number) => string) {
  const names = new Set(stages.map((stage) => stage.name.trim().toLowerCase()));
  let n = stages.length + 1;
  while (names.has(label(n).toLowerCase())) n++;
  return label(n);
}

function query(locale: string | null | undefined): string | undefined {
  return locale ? `locale=${encodeURIComponent(locale)}` : undefined;
}

/** Review workflows API; 404 while the `review` feature is off. */
@Injectable({ providedIn: 'root' })
export class ReviewWorkflows {
  private readonly api = inject(Api);

  /** Needs `workflows.manage`. */
  list(): Promise<Workflow[]> {
    return this.api.get<Workflow[]>('/review-workflows');
  }

  get(id: number | string): Promise<Workflow> {
    return this.api.get<Workflow>(`/review-workflows/${id}`);
  }

  create(input: WorkflowInput): Promise<Workflow> {
    return this.api.post<Workflow>('/review-workflows', input);
  }

  update(id: number, input: WorkflowInput): Promise<Workflow> {
    return this.api.put<Workflow>(`/review-workflows/${id}`, input);
  }

  remove(id: number): Promise<void> {
    return this.api.delete(`/review-workflows/${id}`);
  }

  /** `null` when the type has no workflow. */
  entry(uid: string, documentId: string, locale?: string | null): Promise<EntryReview | null> {
    return this.api.get<EntryReview | null>(`/content/${uid}/${documentId}/review`, query(locale));
  }

  change(
    uid: string,
    documentId: string,
    locale: string | null | undefined,
    change: EntryReviewChange,
  ): Promise<EntryStage> {
    return this.api.put<EntryStage>(`/content/${uid}/${documentId}/review`, change, query(locale));
  }

  /** Stages of list rows (entries without a stored stage are left out), and the workflow. */
  async entries(uid: string, documentIds: string[], locale?: string | null): Promise<EntryStages> {
    const params = [`documentIds=${documentIds.map(encodeURIComponent).join(',')}`];
    if (locale) params.push(`locale=${encodeURIComponent(locale)}`);
    const response = await this.api.list<EntryStage>(`/content/${uid}/review`, params.join('&'));
    const meta = response.meta as { workflow?: Workflow | null } | undefined;
    return { entries: response.data ?? [], workflow: meta?.workflow ?? null };
  }

  /** Active admins who can read the type (needs `content.update` on it). */
  assignees(uid: string): Promise<Assignee[]> {
    return this.api.get<Assignee[]>('/review/assignees', `uid=${encodeURIComponent(uid)}`);
  }

  /** Roles for stage restrictions (`workflows.manage`). */
  roles(): Promise<StageRole[]> {
    return this.api.get<StageRole[]>('/review/roles');
  }

  /** Entries assigned to the caller. */
  assigned(): Promise<EntryStage[]> {
    return this.api.get<EntryStage[]>('/review/assigned');
  }
}
