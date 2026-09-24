import { Injectable } from '@angular/core';
import { TranslocoTranspiler, TranspileParams } from '@jsverse/transloco';
import { IntlMessageFormat } from 'intl-messageformat';

/**
 * ICU MessageFormat for Transloco through FormatJS, which interprets messages instead of
 * compiling them to functions: it runs under the admin's CSP (no `unsafe-eval`).
 */
@Injectable({ providedIn: 'root' })
export class IcuTranspiler implements TranslocoTranspiler {
  private lang = 'en';
  private readonly cache = new Map<string, IntlMessageFormat>();

  transpile({ value, params }: TranspileParams): unknown {
    if (typeof value !== 'string' || !value) return value;
    const key = `${this.lang}\u0000${value}`;
    let format = this.cache.get(key);
    if (!format) {
      try {
        format = new IntlMessageFormat(value, this.lang, undefined, { ignoreTag: true });
      } catch {
        return value;
      }
      this.cache.set(key, format);
    }
    try {
      return format.format(params ?? {});
    } catch {
      // A missing argument: show the message rather than nothing.
      return value;
    }
  }

  onLangChanged(lang: string): void {
    this.lang = lang;
  }
}
