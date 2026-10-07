/**
 * Returns `value` when it is present and throws when it is not.
 *
 * Production code uses this instead of a TypeScript non-null assertion (`!`)
 * where a value cannot be absent because of an invariant the compiler cannot
 * see — a constant key of a fixed table, an element a preceding check proved
 * exists. `invariant` names that invariant, so a violation reports which
 * assumption broke instead of a bare "Cannot read properties of undefined".
 */
export function requireDefined<T>(value: T, invariant: string): NonNullable<T> {
  if (value === undefined || value === null) throw new Error("Invariant violated: " + invariant);
  return value;
}
