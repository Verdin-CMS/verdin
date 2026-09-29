import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HlmToasterImports } from '@spartan-ng/helm/sonner';

import { ConfirmHost } from './shared/components/confirm';

@Component({
  selector: 'vd-root',
  imports: [RouterOutlet, HlmToasterImports, ConfirmHost],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <router-outlet />
    <hlm-toaster richColors position="bottom-right" />
    <vd-confirm-host />
  `,
})
export class App {}
