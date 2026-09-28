import { AttributeType } from '../../core/types';

/** Attribute types the server refuses inside components. */
export const NOT_IN_COMPONENTS: ReadonlySet<AttributeType> = new Set<AttributeType>(['password']);

/**
 * The attribute types offered for a field of a content type or of a component
 * (`password` fields cannot be inside components). `current` stays listed so an existing
 * field still shows its type.
 */
export function offeredTypes<T extends { type: AttributeType }>(
  types: readonly T[],
  component: boolean,
  current?: AttributeType | null,
): T[] {
  if (!component) return [...types];
  return types.filter((info) => !NOT_IN_COMPONENTS.has(info.type) || info.type === current);
}
