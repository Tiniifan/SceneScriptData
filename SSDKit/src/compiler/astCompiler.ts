import { createDefaultRegistry } from '../registry/builtinInstructions';
import { InstructionRegistry } from '../registry/instructionRegistry';
import { ArgType } from '../types/argType';
import type {
  ProgramNode,
  StatementNode,
  ExpressionNode,
  BlockStatementNode,
  IfStatementNode,
  WhileStatementNode,
  FunctionDeclarationNode,
  VariableDeclarationNode,
  PrintStatementNode,
  ShowMessageBoxStatementNode,
  InitializeChildThreadStatementNode,
  AddChildThreadStatementNode,
  UnknownStatementNode,
} from '../types/astNode';
import { RawInstruction, SSDFile } from '../types/rawInstruction';
import { makeRawInstruction, buildSSDHeader, computeInstructionRecordSize } from '../writer/ssdWriter';
import type { SSTWriteEntry } from '../writer/sstWriter';

// ---------------------------------------------------------------------------
// Opcodes (same values as {@link ASTBuilder} / {@link BUILTIN_INSTRUCTIONS}).
// ---------------------------------------------------------------------------

const OP_FUNCTION_DECL = 0x3001;
const OP_IF_CONDITION_FUNC = 0x6012;
const OP_OPEN_BLOCK = 0x6001;
const OP_CLOSE_BLOCK = 0x6002;
const OP_IF = 0x6008;
const OP_ELSE = 0x600c;
const OP_WHILE = 0x6009;
const OP_CREATE_VARIABLE = 0x7001;
const OP_PRINT = 0x3070;
const OP_SHOW_MESSAGE_BOX = 0x301d;
const OP_INIT_CHILD_THREAD = 0x6013;
const OP_ADD_CHILD_THREAD = 0x6014;
const OP_EQUAL = 0x7003;

// ---------------------------------------------------------------------------
// Emitter — walks the AST and produces raw instructions + optional SST rows.
// ---------------------------------------------------------------------------

export interface CompileASTOptions {
  /** When true, no SST buffer is produced (strings still use placeholder ids). */
  skipSst?: boolean;
  /** Four-byte SSD magic; defaults to "SSD\0". */
  magic?: string;
  registry?: InstructionRegistry;
}

export interface CompileASTResult {
  ssdFile: SSDFile;
  sstEntries: SSTWriteEntry[];
}

/**
 * Compiles a {@link ProgramNode} (typically loaded from JSON) into an {@link SSDFile}
 * plus SST rows for every ArgType.String opcode that carries user-visible text.
 */
export function compileAST(program: ProgramNode, options: CompileASTOptions = {}): CompileASTResult {
  // If no register is provided, the default register is used
  const registry = options.registry ?? createDefaultRegistry();
  
  // We pass the register to the Emitter constructor
  const emitter = new Emitter(options, registry); 
  return emitter.run(program);
}

/**
 * Converts an expression node into a descriptive string for error reporting.
 * 
 * This helper identifies the type and content of a node (variable name, 
 * literal value, etc.) to help the user locate invalid standalone 
 * expressions in the source text.
 *
 * @param expr - The expression node to describe.
 * @returns A human-readable string identifying the node.
 */
function nodeToErrorString(expr: ExpressionNode): string {
  if (expr.kind === 'VariableRef') return `Variable: ${expr.name}`;
  if (expr.kind === 'Literal') return `Literal: ${expr.value}`;
  if (expr.kind === 'StringRef') return `String: ${expr.display}`;
  if (expr.kind === 'CallExpression') return `Call: ${expr.name}()`;
  return expr.kind;
}

class Emitter {
  private readonly instructions: RawInstruction[] = [];
  private readonly sstEntries: SSTWriteEntry[] = [];
  private readonly registry: InstructionRegistry;
  
  private nextId = 1;
  private blockOrdinal = 0;
  private readonly opts: CompileASTOptions;

  private functionMap = new Map<string, number>();
  private customFuncNextId = 0x2000;

  constructor(options: CompileASTOptions, registry: InstructionRegistry) {
    this.opts = options;
    this.registry = registry;
  }

  /**
   * Extracts the numeric ID from a name such as func_0xXXXX or var_0xXXXX
   */
  private parseIdFromName(name: string, prefix: string): number | null {
    const regex = new RegExp(`^${prefix}0x([0-9A-Fa-f]+)$`);
    const match = name.match(regex);
    if (match && match[1]) {
      return parseInt(match[1], 16);
    }
    return null;
  }  

  public run(program: ProgramNode): CompileASTResult {
    // First, all the functions declared in the global scope are registered.
    this.registerFunctions(program.body);
    
    // Compile
    this.emitProgram(program);

    return this.finish(program.version, this.opts.magic);
  }

  private registerFunctions(statements: StatementNode[]) {
    for (const stmt of statements) {
      if (stmt.kind === 'FunctionDeclaration') {
        const hexId = this.parseIdFromName(stmt.name, 'func_');
        if (hexId !== null) {
          this.functionMap.set(stmt.name, hexId);
        } else {
          // Function with a custom name (e.g., test())
          const assignedId = this.customFuncNextId++;
          this.functionMap.set(stmt.name, assignedId);
        }
      }
    }
  }  

  private pushInstruction(
    type: number,
    argDescriptors: { type: ArgType; value: number }[],
    unk = 0
  ): number {
    const index = this.instructions.length;
    const id = this.nextId++;
    const inst = makeRawInstruction(index, id, type, unk, argDescriptors);
    this.instructions.push(inst);

    // Bind String-type arguments to this statement in the SST
    for (const arg of argDescriptors) {
      if (arg.type === ArgType.String) {
        // The value of the argument is the index in sstEntries
        const sstEntry = this.sstEntries[arg.value];
        if (sstEntry && sstEntry.instructionId === -1) {
          sstEntry.instructionId = id;
        }
      }
    }

    return id;
  }

  private patchInstructionArgs(index: number, args: number[]): void {
    const inst = this.instructions[index];
    if (!inst) return;
    inst.args = args.map((a) => a >>> 0);
  }

  private emitProgram(program: ProgramNode): void {
    for (const stmt of program.body) {
      this.emitStatement(stmt);
    }
  }

  private emitStatement(stmt: StatementNode): void {
    switch (stmt.kind) {
      case 'FunctionDeclaration':
        this.emitFunctionDeclaration(stmt);
        break;
      case 'IfStatement':
        this.emitIfStatement(stmt);
        break;
      case 'WhileStatement':
        this.emitWhileStatement(stmt);
        break;
      case 'VariableDeclaration':
        this.emitVariableDeclaration(stmt);
        break;
      case 'ExpressionStatement':
        this.emitExpressionStatement(stmt.expression);
        break;
      case 'PrintStatement':
        this.emitPrintStatement(stmt);
        break;
      case 'ShowMessageBoxStatement':
        this.emitShowMessageBoxStatement(stmt);
        break;
      case 'InitializeChildThreadStatement':
        this.emitInitChildThread(stmt);
        break;
      case 'AddChildThreadStatement':
        this.emitAddChildThread(stmt);
        break;
      case 'UnknownStatement':
        this.emitUnknownStatement(stmt);
        break;
      default:
        throw new Error(`astCompiler: unsupported statement kind ${(stmt as StatementNode).kind}`);
    }
  }

  private emitFunctionDeclaration(fn: FunctionDeclarationNode): void {
    // Function ID resolution
    let finalFuncId = this.functionMap.get(fn.name) || 0;

    const params: { type: ArgType; value: number }[] = [
      { type: ArgType.Int, value: fn.ordinal >>> 0 },
      { type: ArgType.Int, value: finalFuncId >>> 0 },
    ];

    for (const p of fn.params) {
      // Automatic resolution of parameter IDs if named var_0x...
      const pVarId = this.parseIdFromName(p.name, 'var_') ?? p.varId;
      params.push({ type: ArgType.Int, value: pVarId >>> 0 });
    }

    this.pushInstruction(OP_FUNCTION_DECL, params, 0);

    if (fn.condition) {
      const condId = this.emitExpressionRoot(fn.condition);
      this.pushInstruction(OP_IF_CONDITION_FUNC, [{ type: ArgType.Instruction, value: condId }], 0);
    }

    this.emitBlock(fn.body);
  }

  private emitIfStatement(node: IfStatementNode): void {
    const condDesc = this.slotToDescriptor(this.emitArgSlot(node.condition));
    this.pushInstruction(OP_IF, [condDesc], 0);
    this.emitBlock(node.consequent);

    if (node.alternate) {
      this.pushInstruction(OP_ELSE, [], 0);
      if (node.alternate.kind === 'IfStatement') {
        this.emitIfStatement(node.alternate);
      } else {
        this.emitBlock(node.alternate);
      }
    }
  }

  private emitWhileStatement(node: WhileStatementNode): void {
    const condDesc = this.slotToDescriptor(this.emitArgSlot(node.condition));
    this.pushInstruction(OP_WHILE, [condDesc], 0);
    this.emitBlock(node.body);
  }

  private emitVariableDeclaration(node: VariableDeclarationNode): void {
    const initSlot = this.emitArgSlot(node.init);
    const initDesc = this.slotToDescriptor(initSlot);
    
    // Extracting the ID if the name is var_0x...
    const finalVarId = this.parseIdFromName(node.name, 'var_') ?? node.varId;

    this.pushInstruction(OP_CREATE_VARIABLE, [
      { type: ArgType.Int, value: finalVarId >>> 0 },
      initDesc,
    ], 0);
  }

  private emitExpressionStatement(expr: ExpressionNode): void {
    this.emitExpressionRoot(expr);
  }

  private emitPrintStatement(stmt: PrintStatementNode): void {
    this.emitPrintfLike(OP_PRINT, stmt.format, stmt.args);
  }

  private emitShowMessageBoxStatement(stmt: ShowMessageBoxStatementNode): void {
    this.emitPrintfLike(OP_SHOW_MESSAGE_BOX, stmt.format, stmt.args);
  }

  private emitPrintfLike(
    opcode: number,
    format: ExpressionNode,
    extraArgs: ExpressionNode[]
  ): void {
    const slots: { type: ArgType; value: number }[] = [];

    // Uses the standard handling for the format and arguments
    slots.push(this.slotToDescriptor(this.emitArgSlot(format)));

    for (const a of extraArgs) {
      slots.push(this.slotToDescriptor(this.emitArgSlot(a)));
    }

    this.pushInstruction(opcode, slots, 0);
    // Note: The SST entry is already handled by slotToDescriptor and pushInstruction
  }

  private emitInitChildThread(stmt: InitializeChildThreadStatementNode): void {
    const unk = this.slotToDescriptor(this.emitArgSlot(stmt.unk1));
    this.pushInstruction(OP_INIT_CHILD_THREAD, [unk], 0);
    this.emitBlock(stmt.body);
  }

  private emitAddChildThread(stmt: AddChildThreadStatementNode): void {
    const unk = this.slotToDescriptor(this.emitArgSlot(stmt.unk1));
    this.pushInstruction(OP_ADD_CHILD_THREAD, [unk], 0);
    this.emitBlock(stmt.body);
  }

  private emitUnknownStatement(stmt: UnknownStatementNode): void {
    const types = stmt.argTypes.map((name) => mapArgTypeName(name));
    const argDescriptors = stmt.args.map((value, i) => ({
      type: types[i] ?? ArgType.Int,
      value: value >>> 0,
    }));
    this.pushInstruction(stmt.opcode, argDescriptors, 0);
  }

  /**
   * OpenBlock is emitted with args[1] = 0 as a placeholder until CloseBlock exists.
   * After CloseBlock is pushed, args[1] is patched to the CloseBlock instruction id
   * (same convention as {@link ASTBuilder.consumeBlock}: cross-references use instruction ids).
   * CloseBlock args[0] stores the paired OpenBlock instruction id.
   */
  private emitBlock(block: BlockStatementNode): void {
    const ord = this.blockOrdinal++;
    const openIndex = this.instructions.length;
    this.pushInstruction(OP_OPEN_BLOCK, [
      { type: ArgType.Int, value: ord >>> 0 },
      { type: ArgType.Int, value: 0 },
    ], 0);

    const openInstId = this.instructions[openIndex]!.id;

    for (const st of block.body) {
      this.emitStatement(st);
    }

    const closeId = this.pushInstruction(OP_CLOSE_BLOCK, [{ type: ArgType.Int, value: openInstId >>> 0 }], 0);

    this.patchInstructionArgs(openIndex, [ord >>> 0, closeId >>> 0]);
  }

  /**
   * Emits opcode rows for `expr` and returns the id of the last instruction
   * (the value consumers pass as ArgType.Instruction).
   */
  private emitExpressionRoot(expr: ExpressionNode): number {
    const slot = this.emitArgSlot(expr);
    if (slot.kind === 'instruction') {
      return slot.id;
    }

    throw new Error(
      `astCompiler: Standalone expression "${nodeToErrorString(expr)}" does not produce an instruction.\n` +
      `Standalone lines must be function calls, assignments (local), or control structures (if/while).`
    );
  }

  private slotToDescriptor(slot: ArgSlot): { type: ArgType; value: number } {
    switch (slot.kind) {
      case 'literal':
        return {
          type: slot.half ? ArgType.HalfFloat : ArgType.Int,
          value: slot.half ? Math.round(slot.value * 4096) >>> 0 : slot.value >>> 0,
        };
      case 'variable':
        return { type: ArgType.Variable, value: slot.varId >>> 0 };
      case 'instruction':
        return { type: ArgType.Instruction, value: slot.id >>> 0 };
      case 'string':
        const stringIndex = this.sstEntries.length;
        if (!this.opts.skipSst) {
          this.sstEntries.push({
            instructionId: -1, // Will be patched in pushInstruction
            unk1: 0,
            unk2: 0,
            text: slot.text,
          });
        }
        return { type: ArgType.String, value: stringIndex >>> 0 };
      default:
        throw new Error('astCompiler: internal slot kind');
    }
  }

  private emitArgSlot(expr: ExpressionNode): ArgSlot {
    switch (expr.kind) {
      case 'Literal':
        return { kind: 'literal', value: expr.value, half: expr.isHalfFloat };
      case 'VariableRef':
        const vId = this.parseIdFromName(expr.name, 'var_') ?? expr.varId;
        return { kind: 'variable', varId: vId };
      case 'StringRef':
        return { kind: 'string', text: expr.display ?? expr.text ?? '' };
      case 'BinaryExpression': {
        const left = this.slotToDescriptor(this.emitArgSlot(expr.left));
        const right = this.slotToDescriptor(this.emitArgSlot(expr.right));
        const id = this.pushInstruction(OP_EQUAL, [left, right], 0);
        return { kind: 'instruction', id };
      }
      case 'CallExpression': {
        const args: { type: ArgType; value: number }[] = [];
        for (const a of expr.args) {
          args.push(this.slotToDescriptor(this.emitArgSlot(a)));
        }

        let opcode = 0;
        const hexId = this.parseIdFromName(expr.name, 'func_');

        if (hexId !== null) {
          opcode = hexId;
        } else if (this.functionMap.has(expr.name)) {
          opcode = this.functionMap.get(expr.name)!;
        } else {
          // Search the register by name
          const def = this.registry.getAll().find(d => d.syntax === expr.name || d.name === expr.name);
          if (def) {
            opcode = def.opcode;
          } else {
            opcode = expr.opcode; // Repli
          }
        }

        const id = this.pushInstruction(opcode, args, 0);
        return { kind: 'instruction', id };
      }
      default:
        throw new Error(`Unsupported expression kind`);
    }
  }

  private finish(version: number, magic?: string): CompileASTResult {
    const instBodyByteLength = this.instructions.reduce(
      (sum, inst) => sum + computeInstructionRecordSize(inst),
      0
    );

    const header = buildSSDHeader(this.instructions.length, instBodyByteLength, version, {
      magic: magic ?? 'SSD\0',
      textCount: this.opts.skipSst ? 0 : this.sstEntries.length,
      textSize: 0,
    });

    const ssdFile: SSDFile = { header, instructions: this.instructions };

    return {
      ssdFile,
      sstEntries: this.opts.skipSst ? [] : [...this.sstEntries],
    };
  }
}

// ---------------------------------------------------------------------------
// ArgSlot — intermediate result for one argument position.
// ---------------------------------------------------------------------------

type ArgSlot =
  | { kind: 'literal'; value: number; half: boolean }
  | { kind: 'variable'; varId: number }
  | { kind: 'instruction'; id: number }
  | { kind: 'string'; text: string };

function mapArgTypeName(name: string): ArgType {
  switch (name) {
    case 'None':
      return ArgType.None;
    case 'Int':
      return ArgType.Int;
    case 'HalfFloat':
      return ArgType.HalfFloat;
    case 'String':
      return ArgType.String;
    case 'Instruction':
      return ArgType.Instruction;
    case 'Variable':
      return ArgType.Variable;
    case 'Variable2':
      return ArgType.Variable2;
    default:
      return ArgType.Int;
  }
}