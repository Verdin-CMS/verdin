import { IcuTranspiler } from './transpiler';

function render(lang: string, value: string, params?: Record<string, unknown>): unknown {
  const transpiler = new IcuTranspiler();
  transpiler.onLangChanged(lang);
  return transpiler.transpile({ value, params, translation: {}, key: 'k' });
}

describe('IcuTranspiler', () => {
  const entries = '{count, plural, one {# wpis} few {# wpisy} many {# wpisów} other {# wpisu}}';

  it('picks plural forms of the language and formats counts', () => {
    expect(render('pl', entries, { count: 1 })).toBe('1 wpis');
    expect(render('pl', entries, { count: 3 })).toBe('3 wpisy');
    expect(render('pl', entries, { count: 5 })).toBe('5 wpisów');
    expect(render('en', '{count, plural, one {# entry} other {# entries}}', { count: 1500 })).toBe(
      '1,500 entries',
    );
    expect(render('es', 'Página {page} de {count, number}', { page: '2', count: 1500 })).toBe(
      'Página 2 de 1500',
    );
  });

  it('keeps literal apostrophes, hashes and markup', () => {
    expect(render('en', "Don''t use `verdin dev` ''{x}''", { x: 'y' })).toBe(
      "Don't use `verdin dev` 'y'",
    );
    expect(render('en', "{count, plural, other {File '#'#}}", { count: 3 })).toBe('File #3');
    expect(render('en', '<b>bold</b> {name}', { name: 'Ada' })).toBe('<b>bold</b> Ada');
  });

  it('falls back to the message when it cannot format', () => {
    expect(render('en', 'Hello {name}')).toBe('Hello {name}');
    expect(render('en', '')).toBe('');
  });
});
