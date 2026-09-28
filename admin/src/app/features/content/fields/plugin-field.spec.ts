import { describe, expect, it } from 'vitest';

import { NO_VALUE, changeValue } from './plugin-field';

function dispatch(target: EventTarget, event: Event): Event {
  target.dispatchEvent(event);
  return event;
}

describe('changeValue', () => {
  it('reads the detail of custom events', () => {
    const element = document.createElement('div');
    expect(changeValue(dispatch(element, new CustomEvent('change', { detail: '#ff0000' })))).toBe(
      '#ff0000',
    );
    expect(changeValue(dispatch(element, new CustomEvent('change', { detail: { a: 1 } })))).toEqual(
      {
        a: 1,
      },
    );
    expect(changeValue(dispatch(element, new CustomEvent('change', { detail: 0 })))).toBe(0);
  });

  it("falls back to the target's value", () => {
    const input = document.createElement('input');
    input.value = 'typed';
    expect(changeValue(dispatch(input, new Event('change')))).toBe('typed');
    const element = Object.assign(document.createElement('div'), { value: 42 });
    expect(changeValue(dispatch(element, new CustomEvent('change')))).toBe(42);
  });

  it('reports a cleared custom event as null, and nothing otherwise', () => {
    const element = document.createElement('div');
    expect(changeValue(dispatch(element, new CustomEvent('change', { detail: null })))).toBeNull();
    expect(changeValue(dispatch(element, new Event('change')))).toBe(NO_VALUE);
  });
});
