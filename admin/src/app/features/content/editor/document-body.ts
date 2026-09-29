import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FieldTree, FormRoot } from '@angular/forms/signals';
import { HlmCardImports } from '@spartan-ng/helm/card';

import { EditView } from '../../../core/edit-view';
import { Attributes, MediaFile } from '../../../core/types';
import { FieldsComponent, FieldsContext } from '../fields/fields';
import { MorphEntry, References } from '../fields/model';

type Tree = FieldTree<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The document's fields, in a form (Enter in a field saves the draft). */
@Component({
  selector: 'vd-document-body',
  imports: [FormRoot, FieldsComponent, HlmCardImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0' },
  template: `
    <form [formRoot]="tree()" (submit)="$event.preventDefault(); submitted.emit()">
      <section hlmCard>
        <div hlmCardContent>
          <vd-fields
            [attributes]="attributes()"
            [tree]="tree()"
            [context]="context()"
            [relationLabels]="relationLabels()"
            [mediaFiles]="mediaFiles()"
            [refs]="refs()"
            [inverse]="inverse()"
            [morphs]="morphs()"
            [shared]="shared()"
            [view]="view()"
            [changed]="changed()"
            prefix="doc"
          />
        </div>
      </section>
    </form>
  `,
})
export class DocumentBody {
  readonly attributes = input.required<Attributes>();
  /** The document's field tree (the form). */
  readonly tree = input.required<Tree>();
  readonly context = input.required<FieldsContext>();
  readonly relationLabels = input<Record<string, Record<string, string>>>({});
  readonly mediaFiles = input<Record<string, MediaFile[]>>({});
  readonly refs = input<References>({ labels: {}, files: [] });
  readonly inverse = input<Record<string, { id: string; label: string }[]>>({});
  readonly morphs = input<Record<string, MorphEntry[]>>({});
  /** Fields shared by every locale (shown as such). */
  readonly shared = input<readonly string[]>([]);
  readonly view = input<EditView | null>(null);
  /** Fields changed by an AI translation, marked until kept or undone. */
  readonly changed = input<readonly string[]>([]);
  readonly submitted = output<void>();
}
