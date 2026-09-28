/**
 * The subset of [JSON Logic](https://jsonlogic.com) that Strapi's conditional fields use
 * (`conditions.visible`): `var`, comparisons, `!`, `!!`, `and`, `or`, `in` and `if`. A port
 * of the server's evaluator (`crates/verdin-content/src/logic.rs`): both must agree on what
 * is hidden. Unknown operators make a condition true, so a field is never hidden by mistake.
 */

type Json = unknown;

/** An attribute's `conditions`, as Strapi 5.17 stores them. */
export interface Conditions {
  visible?: Json;
}

/**
 * Whether an attribute with these `conditions` is visible for `scope` (the other values of
 * the same document or component item).
 */
export function visible(conditions: Conditions | null | undefined, scope: Json): boolean {
  if (!isObject(conditions) || !('visible' in conditions)) return true;
  return truthy(apply(conditions['visible'], scope));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function apply(rule: Json, data: Json): Json {
  if (!isObject(rule)) return rule;
  const keys = Object.keys(rule);
  if (keys.length !== 1) return rule;
  const op = keys[0];
  const raw = rule[op];
  const args: Json[] = Array.isArray(raw) ? raw : [raw];
  const value = (index: number): Json => (index < args.length ? apply(args[index], data) : null);
  switch (op) {
    case 'var': {
      const path = value(0);
      const fallback = value(1);
      let found: Json | undefined;
      if (typeof path === 'string') {
        found = path === '' ? data : lookup(data, path.split('.'));
      } else if (typeof path === 'number') {
        found = Array.isArray(data) && Number.isInteger(path) && path >= 0 ? data[path] : undefined;
      }
      return found === null || found === undefined ? fallback : found;
    }
    case '==':
      return looseEq(value(0), value(1));
    case '!=':
      return !looseEq(value(0), value(1));
    case '===':
      return deepEqual(value(0), value(1));
    case '!==':
      return !deepEqual(value(0), value(1));
    case '<':
    case '>':
    case '<=':
    case '>=': {
      const numbers = args.map((_, index) => number(value(index)));
      if (numbers.length < 2) return false;
      // `{"<": [1, x, 3]}`: between.
      for (let index = 0; index + 1 < numbers.length; index++) {
        const [a, b] = [numbers[index], numbers[index + 1]];
        if (a === null || b === null) return false;
        const holds = op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : a >= b;
        if (!holds) return false;
      }
      return true;
    }
    case '!':
      return !truthy(value(0));
    case '!!':
      return truthy(value(0));
    case 'and': {
      let last: Json = true;
      for (const arg of args) {
        last = apply(arg, data);
        if (!truthy(last)) return last;
      }
      return last;
    }
    case 'or': {
      let last: Json = false;
      for (const arg of args) {
        last = apply(arg, data);
        if (truthy(last)) return last;
      }
      return last;
    }
    case 'in': {
      const [needle, haystack] = [value(0), value(1)];
      if (Array.isArray(haystack)) return haystack.some((item) => looseEq(needle, item));
      if (typeof needle === 'string' && typeof haystack === 'string')
        return haystack.includes(needle);
      return false;
    }
    case 'if':
    case '?:': {
      let index = 0;
      while (index + 1 < args.length) {
        if (truthy(apply(args[index], data))) return apply(args[index + 1], data);
        index += 2;
      }
      return index < args.length ? apply(args[index], data) : null;
    }
    default:
      return true;
  }
}

function lookup(data: Json, keys: string[]): Json | undefined {
  let current: Json | undefined = data;
  for (const key of keys) {
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(key)) return undefined;
      current = current[Number(key)];
    } else if (isObject(current)) {
      if (!Object.prototype.hasOwnProperty.call(current, key)) return undefined;
      current = current[key];
    } else {
      return undefined;
    }
  }
  return current;
}

function truthy(value: Json): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0 && !Number.isNaN(value);
  if (typeof value === 'string') return value !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function number(value: Json): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return null;
    const parsed = Number(text);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value === null || value === undefined) return 0;
  return null;
}

function deepEqual(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return (a ?? null) === (b ?? null);
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]))
    );
  }
  return false;
}

/** JavaScript's `==` for the values conditions compare (strings, numbers, booleans, null). */
function looseEq(a: Json, b: Json): boolean {
  const nullish = (value: Json) => value === null || value === undefined;
  if (nullish(a) && nullish(b)) return true;
  if (nullish(a) || nullish(b)) return false;
  if (typeof a === 'string' && typeof b === 'string') return a === b;
  if (typeof a === 'object' || typeof b === 'object') return deepEqual(a, b);
  const [x, y] = [number(a), number(b)];
  return x !== null && y !== null && x === y;
}

/** A simple rule the builder edits: "show when `field` is (not) `value`". */
export interface SimpleCondition {
  field: string;
  operator: '==' | '!=';
  value: string | number | boolean | null;
}

/** Reads `{ visible: { "==" | "!=": [{ var: field }, value] } }`; anything else is `null`. */
export function simpleCondition(conditions: Conditions | null | undefined): SimpleCondition | null {
  const rule = conditions?.visible;
  if (!isObject(rule)) return null;
  const keys = Object.keys(rule);
  if (keys.length !== 1 || (keys[0] !== '==' && keys[0] !== '!=')) return null;
  const operator = keys[0];
  const args = rule[operator];
  if (!Array.isArray(args) || args.length !== 2) return null;
  const [left, right] = args;
  if (!isObject(left) || Object.keys(left).length !== 1 || typeof left['var'] !== 'string')
    return null;
  if (right !== null && !['string', 'number', 'boolean'].includes(typeof right)) return null;
  return {
    field: left['var'],
    operator,
    value: right as SimpleCondition['value'],
  };
}

/** The `conditions` of a simple rule. */
export function conditionsOf(rule: SimpleCondition): Conditions {
  return { visible: { [rule.operator]: [{ var: rule.field }, rule.value] } };
}
