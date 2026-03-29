/**
 * Returns whether the given type string represents a primitive array type.
 * Example: 'uint8[]' -> true, 'MyObject[]' -> false
 */
export function isPrimitiveArrayTypeString(type: string): boolean {
  const primitiveTypes = ['byte', 'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'float', 'double'];
  if (!type.endsWith('[]')) return false;
  const base = type.slice(0, -2).toLowerCase();
  return primitiveTypes.includes(base);
}

/**
 * Extracts the base primitive type from an array type string.
 * Example: 'uint32[]' -> 'uint32'
 */
export function getPrimitiveTypeFromArray(type: string): string | null {
  if (!type.endsWith('[]')) return null;
  return type.slice(0, -2);
}