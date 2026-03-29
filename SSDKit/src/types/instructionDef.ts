/**
 * Broad category of an instruction, used for grouping and visual styling.
 */
export enum InstructionCategory {
  /** Block delimiters: OpenBlock, CloseBlock */
  Block       = 'Block',
  /** Branching and looping: If, While, Else */
  ControlFlow = 'ControlFlow',
  /** Function declaration structures */
  Function    = 'Function',
  /** Variable creation and assignment */
  Variable    = 'Variable',
  /** Binary or unary operators */
  Operator    = 'Operator',
  /** Regular built-in function calls */
  Call        = 'Call',
  /** Anything not yet identified */
  Unknown     = 'Unknown',
}

/**
 * Describes a single parameter of an instruction.
 * Used to provide rich hover info in the future VS Code extension.
 */
export interface InstructionParamDef {
  /** Symbolic name of the parameter (e.g. "conditionRef", "varId") */
  name: string;
  /** Short human-readable description */
  description: string;
  /**
   * Whether this parameter may be absent.
   * Optional parameters are always at the end of the list.
   */
  optional?: boolean;
}

/**
 * The full definition of a known instruction type.
 * Register instances of this interface in the InstructionRegistry.
 *
 * To add a new instruction type:
 *  1. Create an InstructionDef object with the opcode and metadata.
 *  2. Register it via InstructionRegistry.register().
 *  3. Add handling logic in ASTBuilder.buildStatement() if it requires
 *     custom AST construction (most types are handled generically).
 */
export interface InstructionDef {
  /** Opcode as found in the binary (e.g. 0x6001) */
  opcode: number;
  /** Short machine-friendly name (PascalCase, no spaces) */
  name: string;
  /** One-line human-readable description of what the instruction does */
  description: string;
  /** Broad category, drives AST building strategy and visual styling */
  category: InstructionCategory;
  /**
   * Optional ordered list of parameter descriptors.
   * When present, the length must match the maximum number of arguments
   * this instruction can carry. Trailing optional params may be omitted.
   */
  params?: InstructionParamDef[];
  /**
   * Optional source-level syntax keyword (e.g. "if", "while", "local").
   * Used when generating textual output for debugging.
   */
  syntax?: string;
}