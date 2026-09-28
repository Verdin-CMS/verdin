import { Injectable, signal } from '@angular/core';

/** A related entry to edit in the side sheet. */
export interface RelatedEntryRequest {
  /** The related type's uid. */
  uid: string;
  documentId: string;
  /** The related entry's locale (localized targets). */
  locale: string | null;
}

/**
 * Lets relation pickers open a related entry in the editor's side sheet, and hands the
 * edited entry's new label back to them. Provided by the entry editor; `null` inside the
 * sheet itself (no sheet in a sheet).
 */
@Injectable()
export class RelatedEditor {
  /** The entry open in the sheet. */
  readonly request = signal<RelatedEntryRequest | null>(null);
  /** documentId → label of entries saved from the sheet. */
  readonly labels = signal<Record<string, string>>({});

  open(request: RelatedEntryRequest): void {
    this.request.set(request);
  }

  close(): void {
    this.request.set(null);
  }

  /** Records an entry saved from the sheet, so pickers show its new label. */
  saved(documentId: string, label: string): void {
    this.labels.update((labels) => ({ ...labels, [documentId]: label }));
  }
}
