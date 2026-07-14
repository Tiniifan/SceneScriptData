import * as fs from 'fs';
import * as path from 'path';
import {
    ProgramNode,
    FunctionDeclarationNode,
    FunctionParamNode,
    BlockStatementNode,
    StatementNode,
    ExpressionNode,
    IfStatementNode,
    WhileStatementNode,
    SwitchStatementNode,
    SwitchCaseNode,
    BreakStatementNode,
    ReturnStatementNode,
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
import { validateProgram } from '../compiler/astValidator';

// #region Public API

export interface TextImportOptions {
    /** Only import the function with this name. */
    functionName?: string;
}

/**
 * Parses a plain-text SSD file and converts it to an AST {@link ProgramNode}.
 * This is the reverse operation of the text exporter.
 *
 * Rules enforced during parsing:
 *   - Every statement line (local, print, showMessageBox, expression calls) must end
 *     with a semicolon. A missing semicolon raises an error with the line number.
 *   - Lines starting with `//` are treated as comments and are ignored entirely.
 *
 * @param text - The plain-text SSD content to parse.
 * @param options - Optional parsing options.
 * @returns A complete AST program node.
 */
export function parseProgramFromText(text: string, options: TextImportOptions = {}): ProgramNode {
    const rawLines = text.split('\n');

    const program: ProgramNode = {
        kind: 'Program',
        version: 1,
        body: []
    };

    // -------------------------------------------------------------------------
    // Block stack
    //
    // Rather than a single mutable pointer, we keep a stack so that closing
    // a nested block (}) correctly restores the enclosing scope.
    //
    //   enterBlock(b) — pushes the current block onto the stack and sets b as
    //                   the new active block.
    //   exitBlock()   — pops and restores the previous block (or null at the
    //                   top-most function level).
    //
    // pendingBlock is set by headers that open a scope (function, if, while,
    // initializeChildThread, addChildThread). The following { line consumes it.
    // -------------------------------------------------------------------------

    const blockStack: BlockStatementNode[] = [];
    let currentBlock: BlockStatementNode | null = null;
    let pendingBlock: BlockStatementNode | null = null;

    let currentFunction: FunctionDeclarationNode | null = null;

    function enterBlock(block: BlockStatementNode): void {
        if (currentBlock !== null) {
            blockStack.push(currentBlock);
        }
        currentBlock = block;
    }

    function exitBlock(): void {
        currentBlock = blockStack.pop() ?? null;
    }

    /** Flushes the current function to the program body. */
    function saveCurrentFunction(): void {
        if (currentFunction !== null) {
            program.body.push(currentFunction);
            currentFunction = null;
        }
    }

// -------------------------------------------------------------------------
    // Switch stack
    //
    // A switch's case/default clauses have no textual braces, so they cannot
    // be tracked through the normal enterBlock/exitBlock mechanism. Instead,
    // `activeCase` on the top frame points at the BlockStatementNode currently
    // receiving statements; it is reassigned on every `case:`/`default:` line
    // and cleared by the switch's own closing `}`.
    // -------------------------------------------------------------------------

    interface SwitchFrame {
        node: SwitchStatementNode;
        activeCase: BlockStatementNode | null;
    }

    const switchStack: SwitchFrame[] = [];
    let pendingSwitch: SwitchStatementNode | null = null;

    /** Resolves which block new statements should be appended to. */
    function getTargetBlock(lineNumber: number, trimmed: string): BlockStatementNode {
        if (switchStack.length > 0) {
            const frame = switchStack[switchStack.length - 1];
            if (frame.activeCase === null) {
                throw new Error(
                    `Line ${lineNumber}: statement found directly inside a switch body, outside any "case"/"default": "${trimmed}"`
                );
            }
            return frame.activeCase;
        }
        if (currentBlock === null) {
            throw new Error(`Line ${lineNumber}: statement found outside any block: "${trimmed}"`);
        }
        return currentBlock;
    }    

    // -------------------------------------------------------------------------
    // Main parsing loop
    // -------------------------------------------------------------------------

    for (let lineIndex = 0; lineIndex < rawLines.length; lineIndex++) {
        const lineNumber = lineIndex + 1;
        let trimmed = rawLines[lineIndex].trim();

        // Skip empty lines and line comments
        if (trimmed === '' || trimmed.startsWith('//')) {
            continue;
        }

        // Determine whether this line requires a trailing semicolon.
        // Block delimiters, control-flow headers, and scope-opening keywords
        // (initializeChildThread, addChildThread, requires) do not need one.
        const skipSemiCheck =
            trimmed.startsWith('SSD Program') ||
            trimmed.startsWith('function ')   ||
            trimmed === '{'                    ||
            trimmed === '}'                    ||
            /^if\s*\(/.test(trimmed)           ||
            /^while\s*\(/.test(trimmed)        ||
            /^switch\s*\(/.test(trimmed)       ||
            /^case\s+.+:$/.test(trimmed)       ||
            trimmed === 'default:'             ||
            /^requires\s*\(/.test(trimmed)     ||
            /^}\s*else(\s+if\s*\()?/.test(trimmed) ||
            /^initializeChildThread\s*\(/.test(trimmed) ||
            /^addChildThread\s*\(/.test(trimmed);

        if (!skipSemiCheck) {
            if (!trimmed.endsWith(';')) {
                throw new Error(
                    `Line ${lineNumber}: missing semicolon at end of statement: "${trimmed}"`
                );
            }
            // Strip the trailing semicolon before further processing
            trimmed = trimmed.slice(0, -1).trimEnd();
        }

        // SSD Program header
        if (trimmed.startsWith('SSD Program')) {
            const versionMatch = trimmed.match(/version\s+(\d+)/);
            if (versionMatch) {
                program.version = parseInt(versionMatch[1], 10);
            }
            continue;
        }

        // Function declaration
        if (trimmed.startsWith('function ')) {
            saveCurrentFunction();

            const funcMatch = trimmed.match(/^function\s+(\w+)\s*\(([^)]*)\)/);
            if (!funcMatch) {
                throw new Error(`Line ${lineNumber}: invalid function declaration: "${trimmed}"`);
            }

            currentFunction = {
                kind: 'FunctionDeclaration',
                name: funcMatch[1],
                ordinal: program.body.length + 1,
                funcId: 0x3000 + program.body.length + 1,
                params: parseParameters(funcMatch[2]),
                condition: null,
                body: { kind: 'BlockStatement', body: [], openRaw: -1, closeRaw: -1 },
                raw: []
            };

            pendingBlock = currentFunction.body;
            continue;
        }

        // Optional guard on the current function declaration (requires (...))
        if (/^requires\s*\(/.test(trimmed)) {
            if (currentFunction === null) {
                throw new Error(`Line ${lineNumber}: "requires" clause outside a function declaration.`);
            }
            const parenStart = trimmed.indexOf('(');
            const condition = extractParenthesized(trimmed, parenStart);
            if (condition === null) {
                throw new Error(`Line ${lineNumber}: unbalanced parentheses in "requires": "${trimmed}"`);
            }
            currentFunction.condition = parseExpression(condition);
            continue;
        }

        // Switch statement — pushes the node into the current target block and
        // waits for the following "{" to activate it.
        if (/^switch\s*\(/.test(trimmed)) {
            const target = getTargetBlock(lineNumber, trimmed);
            const parenStart = trimmed.indexOf('(');
            const disc = extractParenthesized(trimmed, parenStart);
            if (disc === null) {
                throw new Error(`Line ${lineNumber}: unbalanced parentheses in "switch": "${trimmed}"`);
            }

            const switchNode: SwitchStatementNode = {
                kind: 'SwitchStatement',
                discriminant: parseExpression(disc),
                cases: [],
                raw: []
            };
            target.body.push(switchNode);
            pendingSwitch = switchNode;
            continue;
        }        

        // Open block — consumes the pending scope opened by the preceding header
        if (trimmed === '{') {
            if (pendingSwitch !== null) {
                switchStack.push({ node: pendingSwitch, activeCase: null });
                pendingSwitch = null;
            } else if (pendingBlock !== null) {
                enterBlock(pendingBlock);
                pendingBlock = null;
            }
            continue;
        }

// case <constant>:
        const caseMatch = trimmed.match(/^case\s+(.+):$/);
        if (caseMatch) {
            if (switchStack.length === 0) {
                throw new Error(`Line ${lineNumber}: "case" found outside a switch.`);
            }
            const frame = switchStack[switchStack.length - 1];

            const valueExpr = parseExpression(caseMatch[1].trim());
            if (valueExpr.kind !== 'Literal' && valueExpr.kind !== 'StringRef') {
                throw new Error(`Line ${lineNumber}: "case" value must be a constant number or string: "${trimmed}"`);
            }

            const consequent: BlockStatementNode = { kind: 'BlockStatement', body: [], openRaw: -1, closeRaw: -1 };
            const clause: SwitchCaseNode = { kind: 'SwitchCase', test: valueExpr, consequent, raw: [] };
            frame.node.cases.push(clause);
            frame.activeCase = consequent;
            continue;
        }

        // default:
        if (trimmed === 'default:') {
            if (switchStack.length === 0) {
                throw new Error(`Line ${lineNumber}: "default" found outside a switch.`);
            }
            const frame = switchStack[switchStack.length - 1];

            const consequent: BlockStatementNode = { kind: 'BlockStatement', body: [], openRaw: -1, closeRaw: -1 };
            const clause: SwitchCaseNode = { kind: 'SwitchCase', test: null, consequent, raw: [] };
            frame.node.cases.push(clause);
            frame.activeCase = consequent;
            continue;
        }        

        // "} else if (...)" — closes the current block then attaches an else-if branch
        const elseIfMatch = trimmed.match(/^}\s*else\s+if\s*\(/);
        if (elseIfMatch) {
            exitBlock();

            // Extract the condition, respecting nested parentheses
            const parenStart = trimmed.indexOf('(', elseIfMatch[0].length - 1);
            const condition = extractParenthesized(trimmed, parenStart);
            if (condition === null) {
                throw new Error(
                    `Line ${lineNumber}: unbalanced parentheses in "else if": "${trimmed}"`
                );
            }

            const elseIfStmt: IfStatementNode = {
                kind: 'IfStatement',
                condition: parseExpression(condition),
                consequent: { kind: 'BlockStatement', body: [], openRaw: -1, closeRaw: -1 },
                alternate: null,
                raw: []
            };

            const parentIf = findLastIf(currentBlock);
            if (!parentIf) {
                throw new Error(
                    `Line ${lineNumber}: "else if" has no matching "if" in the current scope.`
                );
            }
            // Walk to the tail of any existing else-if chain before attaching
            attachAlternate(parentIf, elseIfStmt);

            pendingBlock = elseIfStmt.consequent;
            continue;
        }

        // "} else" — closes the current block then attaches a plain else branch
        if (/^}\s*else\s*$/.test(trimmed)) {
            exitBlock();

            const elseBlock: BlockStatementNode = {
                kind: 'BlockStatement',
                body: [],
                openRaw: -1,
                closeRaw: -1
            };

            const parentIf = findLastIf(currentBlock);
            if (!parentIf) {
                throw new Error(
                    `Line ${lineNumber}: "else" has no matching "if" in the current scope.`
                );
            }
            attachAlternate(parentIf, elseBlock);

            pendingBlock = elseBlock;
            continue;
        }

        // Plain close block — a switch never touches blockStack/currentBlock
        // (see getTargetBlock), so any "}" seen while a switch is active can
        // only be the switch's own closing brace.
        if (trimmed === '}') {
            if (switchStack.length > 0) {
                switchStack.pop();
            } else {
                exitBlock();
            }
            continue;
        }

        const block: BlockStatementNode = getTargetBlock(lineNumber, trimmed);

        // If statement
        if (/^if\s*\(/.test(trimmed)) {
            const parenStart = trimmed.indexOf('(');
            const condition = extractParenthesized(trimmed, parenStart);
            if (condition === null) {
                throw new Error(
                    `Line ${lineNumber}: unbalanced parentheses in "if": "${trimmed}"`
                );
            }

            const ifStmt: IfStatementNode = {
                kind: 'IfStatement',
                condition: parseExpression(condition),
                consequent: { kind: 'BlockStatement', body: [], openRaw: -1, closeRaw: -1 },
                alternate: null,
                raw: []
            };
            block.body.push(ifStmt);
            pendingBlock = ifStmt.consequent;
            continue;
        }

        // While statement
        if (/^while\s*\(/.test(trimmed)) {
            const parenStart = trimmed.indexOf('(');
            const condition = extractParenthesized(trimmed, parenStart);
            if (condition === null) {
                throw new Error(
                    `Line ${lineNumber}: unbalanced parentheses in "while": "${trimmed}"`
                );
            }

            const whileStmt: WhileStatementNode = {
                kind: 'WhileStatement',
                condition: parseExpression(condition),
                body: { kind: 'BlockStatement', body: [], openRaw: -1, closeRaw: -1 },
                raw: []
            };
            block.body.push(whileStmt);
            pendingBlock = whileStmt.body;
            continue;
        }

        // Variable declaration  →  local <name> = <expr>;
        if (trimmed.startsWith('local ')) {
            const varMatch = trimmed.match(/^local\s+(\w+)\s*=\s*(.+)$/);
            if (!varMatch) {
                throw new Error(
                    `Line ${lineNumber}: invalid variable declaration: "${trimmed}"`
                );
            }

            const varDecl: VariableDeclarationNode = {
                kind: 'VariableDeclaration',
                varId: 0,
                name: varMatch[1],
                init: parseExpression(varMatch[2]),
                raw: []
            };
            block.body.push(varDecl);
            continue;
        }

        // break;
        if (trimmed === 'break') {
            block.body.push({ kind: 'BreakStatement', raw: [] } as BreakStatementNode);
            continue;
        }

        // return; or return <expr>;
       if (trimmed === 'return' || /^return\s*\(/.test(trimmed) || /^return\s+/.test(trimmed)) {
            const exprPart = trimmed.slice('return'.length).trim();
            block.body.push({
                kind: 'ReturnStatement',
                argument: exprPart.length > 0 ? parseExpression(exprPart) : null,
                raw: []
            } as ReturnStatementNode);
            continue;
        }        

        // Print statement  →  print(<format>, ...args);
        if (/^print\s*\(/.test(trimmed)) {
            const parenStart = trimmed.indexOf('(');
            const inner = extractParenthesized(trimmed, parenStart);
            if (inner === null) {
                throw new Error(
                    `Line ${lineNumber}: unbalanced parentheses in "print": "${trimmed}"`
                );
            }

            const parts = splitTopLevelCommas(inner);
            block.body.push({
                kind: 'PrintStatement',
                format: parseExpression(parts[0]),
                args: parts.slice(1).map(arg => parseExpression(arg)),
                raw: []
            } as PrintStatementNode);
            continue;
        }

        // showMessageBox statement  →  showMessageBox(<format>, ...args);
        if (/^showMessageBox\s*\(/.test(trimmed)) {
            const parenStart = trimmed.indexOf('(');
            const inner = extractParenthesized(trimmed, parenStart);
            if (inner === null) {
                throw new Error(
                    `Line ${lineNumber}: unbalanced parentheses in "showMessageBox": "${trimmed}"`
                );
            }

            const parts = splitTopLevelCommas(inner);
            block.body.push({
                kind: 'ShowMessageBoxStatement',
                format: parseExpression(parts[0]),
                args: parts.slice(1).map(arg => parseExpression(arg)),
                raw: []
            } as ShowMessageBoxStatementNode);
            continue;
        }

        // initializeChildThread(<unk1>) { ... }
        if (/^initializeChildThread\s*\(/.test(trimmed)) {
            const parenStart = trimmed.indexOf('(');
            const inner = extractParenthesized(trimmed, parenStart);
            if (inner === null) {
                throw new Error(
                    `Line ${lineNumber}: unbalanced parentheses in "initializeChildThread": "${trimmed}"`
                );
            }

            const node: InitializeChildThreadStatementNode = {
                kind: 'InitializeChildThreadStatement',
                unk1: parseExpression(inner),
                body: { kind: 'BlockStatement', body: [], openRaw: -1, closeRaw: -1 },
                raw: []
            };
            block.body.push(node);
            pendingBlock = node.body;
            continue;
        }

        // addChildThread(<unk1>) { ... }
        if (/^addChildThread\s*\(/.test(trimmed)) {
            const parenStart = trimmed.indexOf('(');
            const inner = extractParenthesized(trimmed, parenStart);
            if (inner === null) {
                throw new Error(
                    `Line ${lineNumber}: unbalanced parentheses in "addChildThread": "${trimmed}"`
                );
            }

            const node: AddChildThreadStatementNode = {
                kind: 'AddChildThreadStatement',
                unk1: parseExpression(inner),
                body: { kind: 'BlockStatement', body: [], openRaw: -1, closeRaw: -1 },
                raw: []
            };
            block.body.push(node);
            pendingBlock = node.body;
            continue;
        }

        // Expression statement (standalone function call)  →  someFunc(...);
        if (trimmed.includes('(')) {
            block.body.push({
                kind: 'ExpressionStatement',
                expression: parseExpression(trimmed),
                raw: []
            } as ExpressionStatementNode);
            continue;
        }

        // Unknown statement (raw hex opcode call, e.g. 3003(1, 2, 3))
        if (/^[0-9a-fA-F]+\(/.test(trimmed)) {
            const unknownMatch = trimmed.match(/^([0-9a-fA-F]+)\(([^)]*)\)/);
            if (!unknownMatch) {
                throw new Error(
                    `Line ${lineNumber}: invalid unknown statement: "${trimmed}"`
                );
            }

            const rawArgs = unknownMatch[2].trim();
            const resolvedArgs = rawArgs.length > 0
                ? splitTopLevelCommas(rawArgs).map(arg => parseExpression(arg))
                : [];

            block.body.push({
                kind: 'UnknownStatement',
                opcode: parseInt(unknownMatch[1], 16),
                opcodeHex: unknownMatch[1],
                resolvedArgs,
                raw: []
            } as UnknownStatementNode);
            continue;
        }
    }

    // Save any remaining function that was not followed by another declaration
    saveCurrentFunction();

    // Filter by function name if specified
    if (options.functionName) {
        const filtered = program.body.filter(
            (node): node is FunctionDeclarationNode =>
                node.kind === 'FunctionDeclaration' && node.name === options.functionName
        );
        if (filtered.length === 0) {
            throw new Error(`Function "${options.functionName}" not found in the text.`);
        }
        program.body = filtered;
    }

    // Save any remaining function that was not followed by another declaration
    saveCurrentFunction();

    if (switchStack.length > 0) {
        throw new Error('Unclosed "switch" statement: missing closing "}".');
    }

    // Filter by function name if specified
    if (options.functionName) {
        // ...existing code...
    }

    validateProgram(program);

    return program;
}

/**
 * Parses a plain-text SSD file from disk and converts it to an AST {@link ProgramNode}.
 *
 * @param filePath - Path to the text file to parse.
 * @param options - Optional parsing options.
 * @returns A complete AST program node.
 */
export function parseProgramFromTextFile(filePath: string, options: TextImportOptions = {}): ProgramNode {
    const text = fs.readFileSync(filePath, 'utf8');
    return parseProgramFromText(text, options);
}

// #endregion

// #region Helper Functions

/**
 * Gets the indentation level of a line based on leading spaces.
 */
function getIndentLevel(line: string): number {
    const match = line.match(/^(\s*)/);
    return match ? Math.floor(match[1].length / 2) : 0;
}

/**
 * Parses the parameter list string from a function declaration.
 */
function parseParameters(paramStr: string): FunctionParamNode[] {
    if (!paramStr.trim()) {
        return [];
    }

    return paramStr.split(',').map((param, index) => ({
        varId: index + 1,
        name: param.trim()
    }));
}

/**
 * Extracts the content inside balanced parentheses starting at `openParen`.
 * Returns null when the parentheses are unbalanced.
 *
 * Unlike a simple regex capture, this correctly handles nested calls such as
 * `func_0x700F(var_0x10038, 8192)` inside an outer `if (...)`.
 *
 * @param s - The full source string.
 * @param openParen - Index of the opening `(` character.
 * @returns The inner content (without the enclosing parentheses), or null.
 */
function extractParenthesized(s: string, openParen: number): string | null {
    if (s[openParen] !== '(') return null;
    let depth = 0;
    let inString = false;

    for (let i = openParen; i < s.length; i++) {
        const char = s[i];

        if (char === '"' && s[i - 1] !== '\\') {
            inString = !inString;
            continue;
        }

        if (!inString) {
            if (char === '(') depth++;
            else if (char === ')') {
                depth--;
                if (depth === 0) return s.slice(openParen + 1, i);
            }
        }
    }
    
    return null; // Unbalanced
}

/**
 * Returns the last {@link IfStatementNode} in a block's body, or null when
 * the block is empty or its last statement is not an if.
 */
function findLastIf(block: BlockStatementNode | null): IfStatementNode | null {
    if (!block || block.body.length === 0) return null;
    const last = block.body[block.body.length - 1];
    return last.kind === 'IfStatement' ? (last as IfStatementNode) : null;
}

/**
 * Walks to the tail of an if/else-if chain and attaches `alternate` there.
 * This ensures that a sequence of `} else if` lines builds a proper linked
 * chain rather than always replacing the first alternate.
 */
function attachAlternate(
    ifNode: IfStatementNode,
    alternate: IfStatementNode | BlockStatementNode
): void {
    let node: IfStatementNode = ifNode;
    while (node.alternate !== null && node.alternate.kind === 'IfStatement') {
        node = node.alternate as IfStatementNode;
    }
    node.alternate = alternate;
}

/**
 * Splits a comma-separated argument list at the top level only.
 * Nested parentheses are respected, so `f(a, b), c` yields `["f(a, b)", "c"]`.
 */
function splitTopLevelCommas(text: string): string[] {
    const result: string[] = [];
    let current = '';
    let depth = 0;
    let inString = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];

        if (char === '"' && text[i - 1] !== '\\') {
            inString = !inString;
            current += char;
            continue;
        }

        if (!inString) {
            if (char === '(') depth++;
            if (char === ')') depth--;
            if (char === ',' && depth === 0) {
                result.push(current.trim());
                current = '';
                continue;
            }
        }

        current += char;
    }

    if (current.trim()) result.push(current.trim());
    return result;
}

/**
 * Parses an expression string into an {@link ExpressionNode}.
 *
 * Supports:
 *   - Integer and floating-point literals
 *   - Quoted string literals
 *   - Variable references (`var_0x...` or plain identifiers)
 *   - Function calls with arbitrarily nested arguments
 *   - Binary expressions (`+`, `-`, `*`, `/`)
 *
 * @param expr - The expression source text (already stripped of its semicolon).
 * @returns The corresponding AST expression node.
 */
function parseExpression(expr: string): ExpressionNode {
    const trimmed = expr.trim();

    // Parenthesized expression: (expr) — strip one layer and re-parse.
    if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
        const inner = extractParenthesized(trimmed, 0);
        if (inner !== null && inner.length === trimmed.length - 2) {
            return parseExpression(inner);
        }
    }

    // Integer or float literal
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
        const isFloat = trimmed.includes('.');
        return {
            kind: 'Literal',
            value: parseFloat(trimmed),
            isHalfFloat: isFloat,
            raw: []
        };
    }

    // Quoted string literal
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        return {
            kind: 'StringRef',
            textId: 0,
            text: trimmed.slice(1, -1),
            display: trimmed.slice(1, -1),
            raw: []
        } as StringRefNode;
    }

    // Variable with hex ID (e.g. var_0x20003)
    const varHexMatch = trimmed.match(/^var_0x([0-9A-Fa-f]+)$/);
    if (varHexMatch) {
        return {
            kind: 'VariableRef',
            varId: parseInt(varHexMatch[1], 16),
            name: trimmed,
            raw: []
        } as VariableRefNode;
    }

    // Plain identifier (variable reference or bare name)
    if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
        return {
            kind: 'VariableRef',
            varId: 0,
            name: trimmed,
            raw: []
        } as VariableRefNode;
    }

    // Function call — uses greedy `(.*)` + closing `\)$` to capture everything
    // inside the outermost parentheses, then splits by top-level commas.
    const funcMatch = trimmed.match(/^(\w+)\s*\((.*)\)$/);
    if (funcMatch) {
        const name = funcMatch[1];
        const argText = funcMatch[2].trim();

        // Use a helper to split by comma without breaking nested parentheses
        const args = splitTopLevelCommas(argText).map(arg => parseExpression(arg));

        return {
            kind: 'CallExpression',
            opcode: 0,
            name,
            callKind: 'builtin',
            args,
            raw: []
        } as CallExpressionNode;
    }

    // Binary expression
    const binaryMatch = trimmed.match(/(.+)\s*(==|!=|<=|>=|[+\-*/])\s*(.+)/);
    if (binaryMatch) {
        return {
            kind: 'BinaryExpression',
            left: parseExpression(binaryMatch[1]),
            operator: binaryMatch[2],
            right: parseExpression(binaryMatch[3]),
            raw: []
        } as BinaryExpressionNode;
    }

    // Fallback: treat as a variable reference
    return {
        kind: 'VariableRef',
        varId: 0,
        name: trimmed,
        raw: []
    } as VariableRefNode;
}

// #endregion