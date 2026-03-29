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

        // Open block — consumes the pending scope opened by the preceding header
        if (trimmed === '{') {
            if (pendingBlock !== null) {
                enterBlock(pendingBlock);
                pendingBlock = null;
            }
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

        // Plain close block
        if (trimmed === '}') {
            exitBlock();
            continue;
        }

        // All remaining statement kinds require an active block.
        // We assign to a local const so TypeScript's narrowing works correctly —
        // a captured `let` variable cannot be narrowed through closure calls.
        if (currentBlock === null) {
            throw new Error(
                `Line ${lineNumber}: statement found outside any block: "${trimmed}"`
            );
        }
        const block : BlockStatementNode = currentBlock;

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

            block.body.push({
                kind: 'UnknownStatement',
                opcode: parseInt(unknownMatch[1], 16),
                opcodeHex: unknownMatch[1],
                args: unknownMatch[2].split(',').map(arg => parseInt(arg.trim(), 10) || 0),
                argTypes: [],
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
    for (let i = openParen; i < s.length; i++) {
        if (s[i] === '(') depth++;
        else if (s[i] === ')') {
            depth--;
            if (depth === 0) return s.slice(openParen + 1, i);
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

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char === '(') depth++;
        if (char === ')') depth--;
        if (char === ',' && depth === 0) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
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