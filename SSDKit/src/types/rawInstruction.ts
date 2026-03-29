import { ArgTypeEntry } from './argType';

/**
 * The SSD file header fields.
 */
export interface SSDHeader {
  magic:     string;   // 4-byte ASCII identifier
  version:   number;   // uint32
  size:      number;   // uint32 — total file size
  instCount: number;   // int16  — number of instruction entries
  textCount: number;   // int16  — number of text entries
  instSize:  number;   // uint32 — byte size of the instruction block
  textSize:  number;   // uint32 — byte size of the text block
  pad0:      number;   // uint32 — reserved / unknown
  pad1:      number;   // uint32 — reserved / unknown
}

/**
 * One instruction as read directly from the binary file.
 * No semantic analysis is applied at this stage.
 */
export interface RawInstruction {
  /**
   * Zero-based position of this instruction in the instruction array.
   * Used when instructions cross-reference each other.
   */
  index: number;

  /** Instruction ID as stored in the binary */
  id: number;

  /** Byte size of this instruction entry */
  size: number;

  /** Opcode — identifies the instruction type */
  type: number;

  /** Number of arguments this instruction carries */
  argsCount: number;

  /** Unknown byte, reserved for future analysis */
  unk: number;

  /** Raw packed type bytes before nibble extraction */
  argTypesRaw: number[];

  /**
   * Decoded argument types, one entry per argument.
   * Length is guaranteed to equal argsCount.
   */
  argTypes: ArgTypeEntry[];

  /**
   * Raw argument values (uint32 each).
   * Interpretation depends on the matching ArgType:
   *   - ArgType.Int        -> signed or unsigned integer literal
   *   - ArgType.HalfFloat  -> value / 4096.0
   *   - ArgType.Instruction -> index into the instruction array
   *   - ArgType.Variable   -> variable identifier
   *   - ArgType.Variable2  -> variable identifier (alternate form)
   */
  args: number[];
}

/**
 * Full parsed content of an SSD file, as returned by SSDReader.read().
 */
export interface SSDFile {
  header:       SSDHeader;
  instructions: RawInstruction[];
}