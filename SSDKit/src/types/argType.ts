/**
 * Represents the type of an instruction argument.
 * Each argument in an SSD instruction has a 4-bit type descriptor.
 */
export enum ArgType {
  None      = 0x0,
  Int       = 0x1,
  HalfFloat = 0x2,
  /** Reference to a text string by ID — resolved via the SST file when available. */
  String    = 0x3,
  /** Reference to another instruction by ID */
  Instruction = 0x4,
  /** Reference to a declared variable */
  VarSrc  = 0x5,
  /** Reference to a declared variable (alternate form) */
  VarDst = 0x6,
  Unknown = 99,
}

/**
 * Maps a raw 4-bit value to its ArgType enum member.
 * Returns ArgType.Unknown for unmapped values.
 */
export function resolveArgType(raw: number): ArgType {
  if (raw in ArgType) return raw as ArgType;
  return ArgType.Unknown;
}

/**
 * Returns the display name of an ArgType.
 */
export function argTypeName(type: ArgType): string {
  return ArgType[type] ?? 'Unknown';
}

/**
 * A parsed argument type entry as stored in the raw instruction.
 */
export interface ArgTypeEntry {
  /** Raw 4-bit nibble value */
  raw: number;
  /** Resolved enum value */
  type: ArgType;
  /** Human-readable name */
  name: string;
}

/**
 * Parses an array of packed bytes (2 types per byte, low nibble first) into a flat list of ArgTypeEntry.
 * Stops after `argsCount` valid (non-None) entries have been collected.
 */
export function parseArgTypes(bytes: number[], argsCount: number): ArgTypeEntry[] {
  const entries: ArgTypeEntry[] = [];

  for (const byte of bytes) {
    const low  = byte & 0x0F;
    const high = (byte >> 4) & 0x0F;

    for (const nibble of [low, high]) {
      if (nibble !== ArgType.None) {
        const type = resolveArgType(nibble);
        entries.push({ raw: nibble, type, name: argTypeName(type) });
      }
      // We collect exactly argsCount entries
      if (entries.length >= argsCount) return entries;
    }
  }

  return entries;
}

/**
 * Packs argument type nibbles into the same layout {@link parseArgTypes} expects.
 * Produces exactly `4 * ceil(argsCount / 8)` bytes, matching {@link SSDReader}.
 */
export function packArgTypes(types: ArgType[]): number[] {
  const argsCount = types.length;
  if (argsCount === 0) return [];

  const nibbleCapacity = 8 * Math.ceil(argsCount / 8);
  const nibbles: number[] = [];

  for (let i = 0; i < types.length; i++) {
    const t = types[i];
    if (t === ArgType.None || t === ArgType.Unknown) {
      throw new Error(`packArgTypes: invalid ArgType at index ${i}`);
    }
    nibbles.push(t & 0x0f);
  }

  while (nibbles.length < nibbleCapacity) {
    nibbles.push(ArgType.None);
  }

  const bytes: number[] = [];
  for (let b = 0; b < nibbles.length; b += 2) {
    const low  = nibbles[b] ?? ArgType.None;
    const high = nibbles[b + 1] ?? ArgType.None;
    bytes.push((high << 4) | (low & 0x0f));
  }

  return bytes;
}