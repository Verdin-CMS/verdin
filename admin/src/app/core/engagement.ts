import { Injectable, inject } from '@angular/core';

import { Api } from './api';

/** Votes on one document: `mine` is the caller's vote (1, -1 or 0). */
export interface VoteTally {
  score: number;
  up: number;
  down: number;
  mine: -1 | 0 | 1;
}

export interface TopVoted extends VoteTally {
  documentId: string;
}

export interface Poll {
  id: number;
  question: string;
  options: string[];
  multiple: boolean;
  closed: boolean;
  /** Not closed and not past `closesAt`. */
  open: boolean;
  closesAt: string | null;
  createdAt: string | null;
  createdBy: number | null;
  /** Votes per option. */
  results: number[];
  voters: number;
  /** Indexes the caller chose. */
  mine: number[];
  canManage: boolean;
}

export interface NewPoll {
  question: string;
  options: string[];
  multiple: boolean;
  closesAt?: string | null;
}

/** Seen marks, votes and polls (admin collaboration features). */
@Injectable({ providedIn: 'root' })
export class Engagement {
  private readonly api = inject(Api);

  /** Marks the current version of a document as seen by the caller. */
  view(uid: string, documentId: string): Promise<void> {
    return this.api.put(`/engagement/${uid}/${documentId}/view`, {});
  }

  votes(uid: string, documentIds: string[]): Promise<Record<string, VoteTally>> {
    if (!documentIds.length) return Promise.resolve({});
    const ids = encodeURIComponent(documentIds.join(','));
    return this.api.get(`/engagement/${uid}/votes`, `documentIds=${ids}`);
  }

  vote(uid: string, documentId: string, value: -1 | 0 | 1): Promise<VoteTally> {
    return this.api.put(`/engagement/${uid}/${documentId}/vote`, { value });
  }

  topVoted(uid: string, limit: number): Promise<TopVoted[]> {
    return this.api.get(`/engagement/${uid}/votes/top`, `limit=${limit}`);
  }

  polls(ids?: number[]): Promise<Poll[]> {
    return this.api.get('/polls', ids ? `ids=${ids.join(',')}` : undefined);
  }

  poll(id: number): Promise<Poll> {
    return this.api.get(`/polls/${id}`);
  }

  createPoll(poll: NewPoll): Promise<Poll> {
    return this.api.post('/polls', poll);
  }

  votePoll(id: number, choices: number[]): Promise<Poll> {
    return this.api.put(`/polls/${id}/vote`, { choices });
  }

  closePoll(id: number, closed: boolean): Promise<Poll> {
    return this.api.put(`/polls/${id}`, { closed });
  }

  deletePoll(id: number): Promise<void> {
    return this.api.delete(`/polls/${id}`);
  }
}
