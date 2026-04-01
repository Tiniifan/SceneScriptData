/**
 * Every AST node carries a `kind` discriminant and a `raw` back-reference
 * to the index(es) of the source instruction(s) that produced it.
 * The `raw` array enables round-tripping and source mapping for the VS Code extension.
 */

//#region Leaf / Expression nodes

/** An integer or half-float literal value. */
export interface LiteralNode {
  kind:        'Literal';
  value:       number;
  isHalfFloat: boolean;
  raw:         number[];
}

/** A reference to a declared variable (ArgType.Variable / ArgType.Variable2). */
export interface VariableRefNode {
  kind:  'VariableRef';
  varId: number;
  /** Resolved display name, e.g. "var_0xA" or a user-provided alias. */
  name:  string;
  raw:   number[];
}

/**
 * A reference to a text string by ID (ArgType.String / 0x3).
 *
 * When an SST file is provided, `text` contains the decoded string and `display`
 * shows the actual content.  Without an SST, `text` is undefined and `display`
 * falls back to the placeholder form "${text#0x<id_hex>}".
 *
 * SST rows are keyed by the hosting instruction’s id (`inst.id`), not by `args[argIndex]`.
 */
export interface StringRefNode {
  kind:    'StringRef';
  /** Same as the SSD instruction id for this opcode row — matches SST `instructionId`. */
  textId:  number;
  /** Decoded text from the SST file, or undefined when no SST was loaded. */
  text:    string | undefined;
  /**
   * Human-readable representation:
   *   - With SST:    the actual text, e.g. "MapSetting : %8d"
   *   - Without SST: "${text#0x07}"  (placeholder using `textId` / instruction id in hex)
   */
  display: string;
  raw:     number[];
}

/** A binary expression produced by an operator instruction (e.g. EqualOperator 0x7003). */
export interface BinaryExpressionNode {
  kind:     'BinaryExpression';
  operator: string;        // e.g. "=="
  left:     ExpressionNode;
  right:    ExpressionNode;
  raw:      number[];
}

/**
 * A function call used as an expression (i.e. its result is consumed by another instruction).
 *
 * callKind discriminates the three cases:
 *   'builtin'  — opcode is registered in the InstructionRegistry with category Call.
 *   'custom'   — opcode matches the funcId of a FunctionDeclaration in the same file.
 *   'unknown'  — opcode is not recognised; emitted as func_0xXXXX(...).
 */
export interface CallExpressionNode {
  kind:     'CallExpression';
  opcode:   number;
  name:     string;
  callKind: 'builtin' | 'custom' | 'unknown';
  args:     ExpressionNode[];
  raw:      number[];
}

export type ExpressionNode =
  | LiteralNode
  | VariableRefNode
  | StringRefNode
  | BinaryExpressionNode
  | CallExpressionNode;

//#endregion

//#region Statement nodes

/** local var_<id> = <init> */
export interface VariableDeclarationNode {
  kind:  'VariableDeclaration';
  varId: number;
  name:  string;
  /**
   * The initialiser expression.
   * When ArgType is Instruction this is resolved recursively and may be
   * arbitrarily deep: var = f(g(h(...))).
   */
  init:  ExpressionNode;
  raw:   number[];
}

/** A standalone function call used as a statement (its return value is discarded). */
export interface ExpressionStatementNode {
  kind:       'ExpressionStatement';
  expression: ExpressionNode;
  raw:        number[];
}

/**
 * print(<format>, <arg0>, <arg1>, ...)
 *
 * Produced by instruction 0x3070.
 *   args[0] — text reference (ArgType.String → StringRefNode, or any other expression)
 *   args[1+] — format arguments (variables, literals, or instruction references)
 *
 * Example: print("MapSetting : %8d", var_0x20003)
 */
export interface PrintStatementNode {
  kind:   'PrintStatement';
  /** The format string — typically a StringRefNode. */
  format: ExpressionNode;
  /** Additional arguments that fill format placeholders (%8d, etc.). */
  args:   ExpressionNode[];
  raw:    number[];
}

/**
 * showMessageBox(<format>, <arg0>, …) — instruction 0x301D, même forme que print.
 */
export interface ShowMessageBoxStatementNode {
  kind:   'ShowMessageBoxStatement';
  format: ExpressionNode;
  args:   ExpressionNode[];
  raw:    number[];
}

/** initializeChildThread(<unk1>) { … } — opcode 0x6013 */
export interface InitializeChildThreadStatementNode {
  kind: 'InitializeChildThreadStatement';
  unk1: ExpressionNode;
  body: BlockStatementNode;
  raw:  number[];
}

/** addChildThread(<unk1>) { … } — opcode 0x6014 */
export interface AddChildThreadStatementNode {
  kind: 'AddChildThreadStatement';
  unk1: ExpressionNode;
  body: BlockStatementNode;
  raw:  number[];
}

/**
 * if (<condition>) <consequent> [else <alternate>]
 *
 * alternate is:
 *   null             — no else branch
 *   BlockStatementNode — plain  else { ... }
 *   IfStatementNode    — chained else if (...) { ... }
 */
export interface IfStatementNode {
  kind:       'IfStatement';
  condition:  ExpressionNode;
  consequent: BlockStatementNode;
  alternate:  BlockStatementNode | IfStatementNode | null;
  raw:        number[];
}

/** while (<condition>) <body> */
export interface WhileStatementNode {
  kind:      'WhileStatement';
  condition: ExpressionNode;
  body:      BlockStatementNode;
  raw:       number[];
}

/**
 * Describes a single parameter slot of a declared function.
 * The varId is what appears in args[2+] of the FunctionDeclaration instruction.
 * At call sites, argument position i maps to params[i].varId inside the body.
 */
export interface FunctionParamNode {
  varId: number;
  name:  string;
}

/**
 * function func_<funcId>(<params>) [requires (<condition>)] { <body> }
 *
 * Binary layout of the FunctionDeclaration instruction (0x3001):
 *   args[0]  — ordinal: declaration counter (1st, 2nd … function in the file)
 *   args[1]  — funcId:  the opcode other instructions use to call this function
 *   args[2+] — param variable IDs (Int type): each becomes a local variable inside the body
 *
 * Optional IfConditionFunction (0x6012) may follow immediately; its first arg references
 * the instruction that evaluates the guard (e.g. EqualOperator).
 */
export interface FunctionDeclarationNode {
  kind:      'FunctionDeclaration';
  /** Declaration counter as stored in args[0]. */
  ordinal:   number;
  /** The callable opcode stored in args[1].  Other instructions call this function by using this value as their opcode. */
  funcId:    number;
  /** Display name derived from funcId, e.g. "func_0x2010". */
  name:      string;
  /** Local parameter variable slots declared in args[2+]. */
  params:    FunctionParamNode[];
  /** Guard from the following IfConditionFunction (0x6012), or null. */
  condition: ExpressionNode | null;
  body:      BlockStatementNode;
  raw:       number[];
}

/**
 * A sequence of statements enclosed in { }.
 * openRaw / closeRaw are the array indices of the OpenBlock and CloseBlock instructions.
 */
export interface BlockStatementNode {
  kind:     'BlockStatement';
  body:     StatementNode[];
  /** Array index of the OpenBlock instruction. */
  openRaw:  number;
  /** Array index of the CloseBlock instruction. */
  closeRaw: number;
}

/** Fallback for instructions not yet handled by the AST builder. */
export interface UnknownStatementNode {
  kind:      'UnknownStatement';
  opcode:    number;
  opcodeHex: string;
  resolvedArgs: ExpressionNode[];
  raw:       number[];
}

export type StatementNode =
  | VariableDeclarationNode
  | ExpressionStatementNode
  | PrintStatementNode
  | ShowMessageBoxStatementNode
  | InitializeChildThreadStatementNode
  | AddChildThreadStatementNode
  | IfStatementNode
  | WhileStatementNode
  | FunctionDeclarationNode
  | UnknownStatementNode;

//#endregion

//#region Top-level program node

export interface ProgramNode {
  kind:    'Program';
  version: number;
  body:    StatementNode[];
}

//#endregion

//#region Global AST Node Union

/**
 * Union of all node types
 */
export type ASTNode =
  | ProgramNode
  | BlockStatementNode
  | FunctionDeclarationNode
  | IfStatementNode
  | WhileStatementNode
  | VariableDeclarationNode
  | ExpressionStatementNode
  | PrintStatementNode
  | ShowMessageBoxStatementNode
  | InitializeChildThreadStatementNode
  | AddChildThreadStatementNode
  | UnknownStatementNode
  | LiteralNode
  | VariableRefNode
  | StringRefNode
  | BinaryExpressionNode
  | CallExpressionNode;

//#endregion