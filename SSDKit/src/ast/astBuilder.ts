import { RawInstruction, SSDFile } from '../types/rawInstruction';
import { ArgType } from '../types/argType';
import { InstructionRegistry } from '../registry/instructionRegistry';
import { InstructionCategory } from '../types/instructionDef';
import { SSTFile } from '../reader/sstReader';
import {
    ProgramNode,
    BlockStatementNode,
    StatementNode,
    ExpressionNode,
    FunctionDeclarationNode,
    FunctionParamNode,
    IfStatementNode,
    WhileStatementNode,
    VariableDeclarationNode,
    ExpressionStatementNode,
    PrintStatementNode,
    ShowMessageBoxStatementNode,
    InitializeChildThreadStatementNode,
    AddChildThreadStatementNode,
    UnknownStatementNode,
    LiteralNode,
    VariableRefNode,
    StringRefNode,
    BinaryExpressionNode,
    CallExpressionNode,
} from '../types/astNode';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface Cursor {
    pos: number;
}

/**
 * Metadata recorded for every FunctionDeclaration encountered during the scan pass.
 * Stored by funcId so that any opcode matching a funcId is recognised as a custom call.
 */
interface DeclaredFunction {
    ordinal: number;
    funcId: number;
    name: string;
    paramVarIds: number[];
}

// ---------------------------------------------------------------------------
// ASTBuilder
// ---------------------------------------------------------------------------

/**
 * Converts a raw SSDFile into a typed ProgramNode AST.
 *
 * IMPORTANT — instruction references use instruction IDs, not array indices.
 * IDs are 1-based (the first instruction has id=1, at array index 0).
 * All cross-instruction arg values (whether ArgType.Instruction or the
 * Int-typed block-close reference in OpenBlock args[1]) store an instruction ID.
 * The builder maintains an id→arrayIndex map (Pass -1) and always converts
 * through it before indexing into this.instructions[].
 *
 * Four passes are executed before statement building:
 *
 *   Pass -1 — buildIdMap()
 *     Maps every instruction id to its 0-based array index.
 *
 *   Pass 0 — scanFunctionDeclarations()
 *     Walks all instructions looking for FunctionDeclaration (0x3001).
 *     Records every funcId so that later instructions whose opcode equals
 *     a funcId are recognised as custom function calls rather than unknowns.
 *
 *   Pass 1 — buildReferenceMap()
 *     For every argument whose ArgType is Instruction, marks the target
 *     instruction's ARRAY INDEX as "consumed inline".
 *
 *   Pass 2 — buildStatementList() / recursive block/statement builders.
 */
export class ASTBuilder {
    private readonly instructions: RawInstruction[];
    private readonly registry: InstructionRegistry;

    /**
     * Maps instruction ID (as stored in RawInstruction.id) to its 0-based array index.
     * All cross-instruction references in arg values are IDs, not array indices.
     * Always go through idToArrayIndex() before indexing into this.instructions[].
     */
    private idToIndex!: Map<number, number>;

    /** Maps funcId -> declaration metadata (populated in pass 0). */
    private declaredFunctions!: Map<number, DeclaredFunction>;

    /**
     * Maps instruction array index -> set of instruction indices that reference it
     * via ArgType.Instruction (populated in pass 1).
     */
    private referencedBy!: Map<number, Set<number>>;

    /** Maps variable ID -> display name (populated progressively during building). */
    private variables!: Map<number, string>;

    /** Optional SST file used to resolve ArgType.String text IDs into actual text. */
    private readonly sst: SSTFile | null;

    constructor(file: SSDFile, registry: InstructionRegistry, sst: SSTFile | null = null) {
        this.instructions = file.instructions;
        this.registry = registry;
        this.sst = sst;
    }

    // ---------------------------------------------------------------------------
    // Public entry point
    // ---------------------------------------------------------------------------

    public build(): ProgramNode {
        this.buildIdMap();
        this.scanFunctionDeclarations();
        this.buildReferenceMap();
        this.variables = new Map();
        this.preRegisterVariables();

        const cursor: Cursor = { pos: 0 };
        const body = this.buildStatementList(cursor, this.instructions.length);

        return { kind: 'Program', version: 0, body };
    }

    // ---------------------------------------------------------------------------
    // Pass -1 — ID → array index map
    // ---------------------------------------------------------------------------

    /**
     * Instruction IDs are stored in RawInstruction.id and are 1-based in the
     * observed files (id = array_index + 1), but we never assume that — we build
     * an explicit map instead.
     */
    private buildIdMap(): void {
        this.idToIndex = new Map();
        for (const inst of this.instructions) {
            this.idToIndex.set(inst.id, inst.index);
        }
    }

    /**
     * Converts an instruction ID (as found in arg values) to a 0-based array index.
     * Returns -1 when the ID is not found (corrupt/unknown reference).
     */
    private idToArrayIndex(id: number): number {
        return this.idToIndex.get(id) ?? -1;
    }

    // ---------------------------------------------------------------------------
    // Pass 0 — scan function declarations
    // ---------------------------------------------------------------------------

    /**
     * FunctionDeclaration (0x3001) binary layout:
     *   args[0]  — ordinal (1-based declaration counter)
     *   args[1]  — funcId  (the opcode used to call this function)
     *   args[2+] — local parameter variable IDs (Int type)
     */
    private scanFunctionDeclarations(): void {
        this.declaredFunctions = new Map();

        for (const inst of this.instructions) {
            if (inst.type !== 0x3001) continue;
            if (inst.args.length < 2) continue;

            const ordinal = inst.args[0];
            const funcId = inst.args[1];
            const name = `func_0x${funcId.toString(16).toUpperCase()}`;
            const paramVarIds = inst.args.slice(2);

            this.declaredFunctions.set(funcId, { ordinal, funcId, name, paramVarIds });
        }
    }

    // ---------------------------------------------------------------------------
    // Pass 1 — build the reference map
    // ---------------------------------------------------------------------------

    /**
     * An instruction is "inline" when at least one other instruction references
     * it via ArgType.Instruction.
     *
     * The arg value is an instruction ID — convert to array index before storing.
     */
    private buildReferenceMap(): void {
        this.referencedBy = new Map();

        for (const inst of this.instructions) {
            for (let a = 0; a < inst.argTypes.length; a++) {
                const argType = inst.argTypes[a];
                if (!argType || argType.type !== ArgType.Instruction) continue;

                // arg value is an instruction ID — resolve to array index
                const refArrayIdx = this.idToArrayIndex(inst.args[a]);
                if (refArrayIdx === -1) continue;

                if (!this.referencedBy.has(refArrayIdx)) {
                    this.referencedBy.set(refArrayIdx, new Set());
                }
                this.referencedBy.get(refArrayIdx)!.add(inst.index);
            }
        }
    }

    private isInlineExpression(index: number): boolean {
        return (this.referencedBy.get(index)?.size ?? 0) > 0;
    }

    // ---------------------------------------------------------------------------
    // Pass 1.5 — pre-register variable names
    // ---------------------------------------------------------------------------

    private preRegisterVariables(): void {
        for (const inst of this.instructions) {
            // CreateVariable args[0] = varId
            if (inst.type === 0x7001 && inst.args.length > 0) {
                this.registerVar(inst.args[0]);
            }
            // FunctionDeclaration args[2+] = param varIds
            if (inst.type === 0x3001 && inst.args.length > 2) {
                for (let a = 2; a < inst.args.length; a++) {
                    this.registerVar(inst.args[a]);
                }
            }
        }
    }

    private registerVar(varId: number): void {
        if (!this.variables.has(varId)) {
            this.variables.set(varId, `var_0x${varId.toString(16).toUpperCase()}`);
        }
    }

    // ---------------------------------------------------------------------------
    // Pass 2 — sequential statement builder
    // ---------------------------------------------------------------------------

    private buildStatementList(cursor: Cursor, endExclusive: number): StatementNode[] {
        const statements: StatementNode[] = [];

        while (cursor.pos < endExclusive) {
            const inst = this.instructions[cursor.pos];

            // CloseBlock ends the current block — do NOT consume it here; the caller does.
            if (inst.type === 0x6002) break;

            // Skip instructions consumed inline as expressions.
            if (this.isInlineExpression(inst.index)) {
                cursor.pos++;
                continue;
            }

            const node = this.buildStatement(cursor);
            if (node !== null) statements.push(node);
        }

        return statements;
    }

    // ---------------------------------------------------------------------------
    // Statement dispatch
    // ---------------------------------------------------------------------------

    private buildStatement(cursor: Cursor): StatementNode | null {
        const inst = this.instructions[cursor.pos];
        const opcode = inst.type;

        switch (opcode) {
            case 0x3001: return this.buildFunctionDeclaration(cursor);

            // These should always be consumed by their parent builder (consumeBlock,
            // buildIfStatement, buildFunctionDeclaration).  If they somehow reach
            // buildStatementList as a standalone instruction, advance the cursor so
            // we never stall — the infinite loop source.
            case 0x6001: cursor.pos++; return null;
            case 0x600C: cursor.pos++; return null;
            case 0x6012: cursor.pos++; return null;

            case 0x6008: return this.buildIfStatement(cursor);
            case 0x6009: return this.buildWhileStatement(cursor);
            case 0x7001: return this.buildVariableDeclaration(cursor);
            case 0x3070: return this.buildPrintStatement(cursor);
            case 0x301D: return this.buildShowMessageBoxStatement(cursor);
            case 0x6013: return this.buildInitializeChildThreadStatement(cursor);
            case 0x6014: return this.buildAddChildThreadStatement(cursor);
            default: {
                if (this.declaredFunctions.has(opcode)) {
                    return this.buildExpressionStatement(cursor);
                }
                const def = this.registry.get(opcode);
                if (def && (def.category === InstructionCategory.Call ||
                    def.category === InstructionCategory.Operator)) {
                    return this.buildExpressionStatement(cursor);
                }
                return this.buildUnknownStatement(cursor);
            }
        }
    }

    // ---------------------------------------------------------------------------
    // FunctionDeclaration (0x3001)
    // ---------------------------------------------------------------------------

    private skipInlines(cursor: Cursor): void {
        while (
            cursor.pos < this.instructions.length &&
            this.isInlineExpression(this.instructions[cursor.pos].index)
        ) {
            cursor.pos++;
        }
    }

    /**
     * Layout consumed from the stream:
     *
     *   FunctionDeclaration (0x3001)      — cursor.pos on entry
     *   [IfConditionFunction (0x6012)]?   — optional, immediately following;
     *                                       args[0] = instruction ref → condition expression
     *   OpenBlock (0x6001)
     *     ... body ...
     *   CloseBlock (0x6002)
     *
     * args[0] — ordinal
     * args[1] — funcId  (the callable opcode)
     * args[2+] — parameter variable IDs
     */
    private buildFunctionDeclaration(cursor: Cursor): FunctionDeclarationNode {
        const inst = this.instructions[cursor.pos];
        const ordinal = inst.args[0] ?? 0;
        const funcId = inst.args[1] ?? 0;
        const name = `func_0x${funcId.toString(16).toUpperCase()}`;
        const raw: number[] = [inst.index];

        const params: FunctionParamNode[] = [];
        for (let a = 2; a < inst.args.length; a++) {
            const varId = inst.args[a];
            this.registerVar(varId);
            params.push({ varId, name: this.variables.get(varId)! });
        }

        cursor.pos++; // consume FunctionDeclaration

        // Skip inline expressions before searching for the requires
        this.skipInlines(cursor);

        let condition: ExpressionNode | null = null;
        if (cursor.pos < this.instructions.length &&
            this.instructions[cursor.pos].type === 0x6012) {
            const condInst = this.instructions[cursor.pos];
            raw.push(condInst.index);
            condition = this.resolveArg(condInst, 0);
            cursor.pos++; // consume IfConditionFunction
        }

        const body = this.consumeBlock(cursor);

        return { kind: 'FunctionDeclaration', ordinal, funcId, name, params, condition, body, raw };
    }

    // ---------------------------------------------------------------------------
    // IfStatement (0x6008)
    // ---------------------------------------------------------------------------

    /**
     * args[0] — condition (ArgType.Instruction or direct value)
     *
     * After the consequent block:
     *   0x600C followed by 0x6008  -> else-if chain (recursive)
     *   0x600C alone               -> plain else block
     *   anything else              -> no alternate
     */
    private buildIfStatement(cursor: Cursor): IfStatementNode {
        const inst = this.instructions[cursor.pos];
        const raw = [inst.index];
        const condition = this.resolveArg(inst, 0);
        cursor.pos++;

        const consequent = this.consumeBlock(cursor);

        let alternate: BlockStatementNode | IfStatementNode | null = null;

        if (cursor.pos < this.instructions.length &&
            this.instructions[cursor.pos].type === 0x600C) {
            cursor.pos++; // consume Else

            // We skip the inline conditions that precede the next IF statement
            this.skipInlines(cursor);

            if (cursor.pos < this.instructions.length &&
                this.instructions[cursor.pos].type === 0x6008) {
                // else if — build the nested If as the alternate
                alternate = this.buildIfStatement(cursor);
            } else {
                // plain else block
                alternate = this.consumeBlock(cursor);
            }
        }

        return { kind: 'IfStatement', condition, consequent, alternate, raw };
    }

    // ---------------------------------------------------------------------------
    // WhileStatement (0x6009)
    // ---------------------------------------------------------------------------

    private buildWhileStatement(cursor: Cursor): WhileStatementNode {
        const inst = this.instructions[cursor.pos];
        const raw = [inst.index];
        const condition = this.resolveArg(inst, 0);
        cursor.pos++;
        const body = this.consumeBlock(cursor);
        return { kind: 'WhileStatement', condition, body, raw };
    }

    // ---------------------------------------------------------------------------
    // Block consumption — OpenBlock (0x6001) ... CloseBlock (0x6002)
    // ---------------------------------------------------------------------------

    /**
     * OpenBlock args:
     *   args[0] — block ordinal (ignored by the builder)
     *   args[1] — ID of the matching CloseBlock instruction
     *             (NOT a direct array index — must go through idToArrayIndex)
     *
     * Example from a real file:
     *   index 1, id=0x0002, OpenBlock, args=[0x0, 0x10]
     *   args[1] = 0x10 = 16  →  CloseBlock with id=16 is at array index 15
     *
     * IMPORTANT: inline expression instructions (ArgType.Instruction-referenced)
     * may sit between the control instruction (If/While/FunctionDeclaration) and
     * its OpenBlock.  Example:
     *
     *   27  If      args=[0x1D]    ← condition references inst id 29 (index 28)
     *   28  0x7002  inline expr    ← referenced by If
     *   29  0x700F  inline expr    ← referenced by 28
     *   30  OpenBlock              ← this is the real block start
     *
     * consumeBlock must skip those inlines before checking for the OpenBlock.
     */
    private consumeBlock(cursor: Cursor): BlockStatementNode {
        // Skip inline expression instructions that sit before the OpenBlock.
        // Stop as soon as we hit a non-inline, a CloseBlock, or an OpenBlock.
        while (
            cursor.pos < this.instructions.length &&
            this.instructions[cursor.pos].type !== 0x6001 &&
            this.instructions[cursor.pos].type !== 0x6002 &&
            this.isInlineExpression(this.instructions[cursor.pos].index)
        ) {
            cursor.pos++;
        }

        if (cursor.pos >= this.instructions.length ||
            this.instructions[cursor.pos].type !== 0x6001) {
            return { kind: 'BlockStatement', body: [], openRaw: -1, closeRaw: -1 };
        }

        const openInst = this.instructions[cursor.pos];
        const openRaw = openInst.index;

        // args[1] is the ID of the paired CloseBlock — convert to array index
        const closeBlockId = openInst.args.length >= 2 ? openInst.args[1] : openInst.args[0];
        const closeArrayIdx = this.idToArrayIndex(closeBlockId);

        if (closeArrayIdx === -1) {
            cursor.pos++;
            return { kind: 'BlockStatement', body: [], openRaw, closeRaw: -1 };
        }

        cursor.pos++; // consume OpenBlock

        const body = this.buildStatementList(cursor, closeArrayIdx + 1);

        let closeRaw = -1;
        if (cursor.pos < this.instructions.length &&
            this.instructions[cursor.pos].type === 0x6002) {
            closeRaw = this.instructions[cursor.pos].index;
            cursor.pos++; // consume CloseBlock
        }

        return { kind: 'BlockStatement', body, openRaw, closeRaw };
    }

    // ---------------------------------------------------------------------------
    // VariableDeclaration (0x7001)
    // ---------------------------------------------------------------------------

    /**
     * args[0] — variable ID (always Int)
     * args[1] — initial value:
     *             ArgType.Int        -> literal
     *             ArgType.Instruction -> recursive expression  (var = f(g(h(...))))
     *             ArgType.Variable   -> copy of another variable
     */
    private buildVariableDeclaration(cursor: Cursor): VariableDeclarationNode {
        const inst = this.instructions[cursor.pos];
        const varId = inst.args[0];

        this.registerVar(varId);
        const name = this.variables.get(varId)!;

        const init: ExpressionNode = inst.args.length > 1
            ? this.resolveArg(inst, 1)
            : ({ kind: 'Literal', value: 0, isHalfFloat: false, raw: [inst.index] } as LiteralNode);

        cursor.pos++;
        return { kind: 'VariableDeclaration', varId, name, init, raw: [inst.index] };
    }

    // ---------------------------------------------------------------------------
    // PrintStatement (0x3070)
    // ---------------------------------------------------------------------------

    /**
     * print(<format>, <arg0>, <arg1>, ...)
     *
     *   args[0] — format: ArgType.String → StringRefNode resolved via SST;
     *             can also be Instruction, Variable, or Int (treated generically).
     *   args[1+] — optional format arguments (Variable, Instruction, Int, etc.)
     *
     * Example: print("MapSetting : %8d", var_0x20003)
     */
    private buildPrintStatement(cursor: Cursor): PrintStatementNode {
        const inst = this.instructions[cursor.pos];
        const raw = [inst.index];
        const format = this.resolveArg(inst, 0);
        const args: ExpressionNode[] = [];
        for (let a = 1; a < inst.args.length; a++) {
            args.push(this.resolveArg(inst, a));
        }
        cursor.pos++;
        return { kind: 'PrintStatement', format, args, raw };
    }

    // ---------------------------------------------------------------------------
    // ShowMessageBox (0x301D) — same format as print (text + optional arguments)
    // ---------------------------------------------------------------------------

    private buildShowMessageBoxStatement(cursor: Cursor): ShowMessageBoxStatementNode {
        const inst = this.instructions[cursor.pos];
        const raw = [inst.index];
        const format = this.resolveArg(inst, 0);
        const args: ExpressionNode[] = [];
        for (let a = 1; a < inst.args.length; a++) {
            args.push(this.resolveArg(inst, a));
        }
        cursor.pos++;
        return { kind: 'ShowMessageBoxStatement', format, args, raw };
    }

    // ---------------------------------------------------------------------------
    // initializeChildThread (0x6013) / addChildThread (0x6014) — opcode then { ... }
    // ---------------------------------------------------------------------------

    private buildInitializeChildThreadStatement(cursor: Cursor): InitializeChildThreadStatementNode {
        const inst = this.instructions[cursor.pos];
        const raw = [inst.index];
        const unk1 = this.resolveArg(inst, 0);
        cursor.pos++;
        const body = this.consumeBlock(cursor);
        return { kind: 'InitializeChildThreadStatement', unk1, body, raw };
    }

    private buildAddChildThreadStatement(cursor: Cursor): AddChildThreadStatementNode {
        const inst = this.instructions[cursor.pos];
        const raw = [inst.index];
        const unk1 = this.resolveArg(inst, 0);
        cursor.pos++;
        const body = this.consumeBlock(cursor);
        return { kind: 'AddChildThreadStatement', unk1, body, raw };
    }

    // ---------------------------------------------------------------------------
    // ExpressionStatement
    // ---------------------------------------------------------------------------

    private buildExpressionStatement(cursor: Cursor): ExpressionStatementNode {
        const inst = this.instructions[cursor.pos];
        const expression = this.buildExpression(inst);
        cursor.pos++;
        return { kind: 'ExpressionStatement', expression, raw: [inst.index] };
    }

    // ---------------------------------------------------------------------------
    // UnknownStatement fallback
    // ---------------------------------------------------------------------------

    private buildUnknownStatement(cursor: Cursor): UnknownStatementNode {
        const inst = this.instructions[cursor.pos];
        cursor.pos++;
        return {
            kind: 'UnknownStatement',
            opcode: inst.type,
            opcodeHex: `0x${inst.type.toString(16).toUpperCase().padStart(4, '0')}`,
            args: [...inst.args],
            argTypes: inst.argTypes.map((a) => a.name),
            raw: [inst.index],
        };
    }

    // ---------------------------------------------------------------------------
    // Expression building
    // ---------------------------------------------------------------------------

    /**
     * Builds an ExpressionNode from a given instruction.
     *
     *   EqualOperator (0x7003)        -> BinaryExpressionNode
     *   IfConditionFunction (0x6012)  -> resolves its condition arg
     *   opcode in declaredFunctions   -> CallExpressionNode (callKind = 'custom')
     *   opcode in registry (Call)     -> CallExpressionNode (callKind = 'builtin')
     *   anything else                 -> CallExpressionNode (callKind = 'unknown')
     */
    private buildExpression(inst: RawInstruction): ExpressionNode {
        const opcode = inst.type;

        // --- EqualOperator ---
        if (opcode === 0x7003) {
            return {
                kind: 'BinaryExpression',
                operator: '==',
                left: this.resolveArg(inst, 0),
                right: this.resolveArg(inst, 1),
                raw: [inst.index],
            } as BinaryExpressionNode;
        }

        // --- IfConditionFunction — expose its condition ---
        if (opcode === 0x6012) {
            return this.resolveArg(inst, 0);
        }

        // --- Custom function call ---
        const customDecl = this.declaredFunctions.get(opcode);
        if (customDecl) {
            return {
                kind: 'CallExpression',
                opcode,
                name: customDecl.name,
                callKind: 'custom',
                args: inst.args.map((_, a) => this.resolveArg(inst, a)),
                raw: [inst.index],
            } as CallExpressionNode;
        }

        // --- Known built-in ---
        const def = this.registry.get(opcode);
        if (def) {
            return {
                kind: 'CallExpression',
                opcode,
                name: def.syntax ?? def.name,
                callKind: 'builtin',
                args: inst.args.map((_, a) => this.resolveArg(inst, a)),
                raw: [inst.index],
            } as CallExpressionNode;
        }

        // --- Unknown ---
        return {
            kind: 'CallExpression',
            opcode,
            name: `func_0x${opcode.toString(16).toUpperCase()}`,
            callKind: 'unknown',
            args: inst.args.map((_, a) => this.resolveArg(inst, a)),
            raw: [inst.index],
        } as CallExpressionNode;
    }

    /**
     * Resolves one argument of `inst` at position `argIndex` into an ExpressionNode.
     *
     * ArgType.Instruction
     *   The value is an instruction ID — convert to array index via idToArrayIndex(),
     *   then call buildExpression() on that instruction recursively.
     *   This handles arbitrarily deep chains: var = f(g(h(...)))
     *
     * ArgType.String                ->  StringRefNode (SST lookup uses inst.id, not args[])
     * ArgType.Variable / Variable2  ->  VariableRefNode
     * ArgType.HalfFloat             ->  LiteralNode (value / 4096.0)
     * ArgType.Int / default         ->  LiteralNode
     */
    private resolveArg(inst: RawInstruction, argIndex: number): ExpressionNode {
        if (argIndex >= inst.args.length) {
            return { kind: 'Literal', value: 0, isHalfFloat: false, raw: [inst.index] };
        }

        const value = inst.args[argIndex];
        const argType = inst.argTypes[argIndex];

        if (!argType) {
            return { kind: 'Literal', value, isHalfFloat: false, raw: [inst.index] };
        }

        switch (argType.type) {
            case ArgType.String: {
                // SST entries are indexed by the instruction ID that contains the string (inst.id),
                // Update: not really, It's more by index; we'll have to correct that one day
                const text = this.sst?.getText(inst.id);
                const display = text !== undefined
                    ? text
                    : `\${text#0x${inst.id.toString(16).toUpperCase()}}`;
                return {
                    kind: 'StringRef',
                    textId: inst.id,
                    text,
                    display,
                    raw: [inst.index],
                } as StringRefNode;
            }

            case ArgType.Instruction: {
                // value is an instruction ID — resolve to array index first
                const arrayIdx = this.idToArrayIndex(value);
                if (arrayIdx !== -1) {
                    return this.buildExpression(this.instructions[arrayIdx]);
                }
                // Unknown ID — emit as an unknown call placeholder
                return {
                    kind: 'CallExpression',
                    opcode: value,
                    name: `func_0x${value.toString(16).toUpperCase()}`,
                    callKind: 'unknown',
                    args: [],
                    raw: [inst.index],
                } as CallExpressionNode;
            }

            case ArgType.Variable:
            case ArgType.Variable2: {
                const name = this.variables.get(value)
                    ?? `var_0x${value.toString(16).toUpperCase()}`;
                return { kind: 'VariableRef', varId: value, name, raw: [inst.index] };
            }

            case ArgType.HalfFloat:
                return { kind: 'Literal', value: value / 4096.0, isHalfFloat: true, raw: [inst.index] };

            case ArgType.Int:
            default:
                return { kind: 'Literal', value, isHalfFloat: false, raw: [inst.index] };
        }
    }
}

// ---------------------------------------------------------------------------
// Convenience wrapper
// ---------------------------------------------------------------------------

export function buildAST(
    file: SSDFile,
    registry: InstructionRegistry,
    sst: SSTFile | null = null
): ProgramNode {
    const builder = new ASTBuilder(file, registry, sst);
    const program = builder.build();
    program.version = file.header.version;
    return program;
}