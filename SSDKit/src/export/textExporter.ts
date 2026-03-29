import * as fs from 'fs';
import * as path from 'path';
import {
    ExpressionNode,
    ProgramNode,
    FunctionDeclarationNode,
    BlockStatementNode,
    StatementNode,
    IfStatementNode,
    WhileStatementNode,
} from '../types/astNode';

// #region Public API

export interface TextExportOptions {
    /** Only export the function with this name. */
    functionName?: string;
    /**
     * Number of spaces per indentation level (default: 2).
     * Each block nesting adds one level.
     */
    indentSize?: number;
}

/**
 * Renders a {@link ProgramNode} (or a single function within it) as a
 * human-readable plain-text string that mirrors the visual hierarchy produced
 * by the SVG image exporter.
 *
 * Every statement line ends with a semicolon so that the output can be fed
 * back into {@link parseProgramFromText} without modification.
 *
 * @param program - The root AST node to render.
 * @param options - Optional rendering options.
 * @returns A multi-line string representation of the AST.
 */
export function exportToText(program: ProgramNode, options: TextExportOptions = {}): string {
    const indentSize = options.indentSize ?? 2;
    const ctx = new TextLayoutContext(indentSize);

    if (options.functionName) {
        const fn = findFunction(program, options.functionName);
        if (!fn) throw new Error(`Function "${options.functionName}" not found in the AST.`);
        return ctx.renderFunction(fn, 0).join('\n');
    }

    return ctx.renderProgram(program, 0).join('\n');
}

/**
 * Writes the plain-text representation to a file and returns the output path.
 *
 * @param program    - The root AST node to render.
 * @param outputPath - Destination file path.
 * @param options    - Optional rendering options.
 * @returns The resolved output path.
 */
export function exportToTextFile(
    program: ProgramNode,
    outputPath: string,
    options: TextExportOptions = {}
): string {
    const text = exportToText(program, options);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, text, 'utf8');
    return outputPath;
}

// #endregion

// #region Layout Engine

/**
 * Walks the AST and produces an array of indented lines.
 * The indentation logic mirrors the nesting/boxing model used in the SVG exporter.
 */
class TextLayoutContext {
    private readonly indentSize: number;

    constructor(indentSize: number) {
        this.indentSize = indentSize;
    }

    // -------------------------------------------------------------------------
    // Program
    // -------------------------------------------------------------------------

    renderProgram(program: ProgramNode, depth: number): string[] {
        const lines: string[] = [];
        lines.push(this.indent(depth) + `SSD Program  (version ${program.version})`);

        for (let i = 0; i < program.body.length; i++) {
            const stmt = program.body[i];

            // Add a blank line before each function (except the very first line of the program)
            if (i > 0 && stmt.kind === 'FunctionDeclaration') {
                lines.push('');
            }

            lines.push(...this.renderStatement(stmt, depth + 1));
        }

        return lines;
    }

    // -------------------------------------------------------------------------
    // Function declaration
    // -------------------------------------------------------------------------

    renderFunction(fn: FunctionDeclarationNode, depth: number): string[] {
        const params = fn.params.map((p) => p.name).join(', ');
        const lines: string[] = [];

        lines.push(this.indent(depth) + `function ${fn.name}(${params})`);

        if (fn.condition) {
            lines.push(this.indent(depth) + `requires (${exprToString(fn.condition)})`);
        }

        lines.push(...this.renderBlock(fn.body, depth));
        return lines;
    }

    // -------------------------------------------------------------------------
    // Block  { ... }
    // -------------------------------------------------------------------------

    renderBlock(block: BlockStatementNode, depth: number): string[] {
        const lines: string[] = [];
        lines.push(this.indent(depth) + '{');

        for (let i = 0; i < block.body.length; i++) {
            const stmt = block.body[i];

            // Smart line break logic:
            // Add a blank line BEFORE a statement if:
            //   1. It is not the first statement in the block.
            //   2. The current statement is a block (if/while) OR the previous one was.
            if (i > 0) {
                const prevStmt = block.body[i - 1];
                const isCurrentBlock = stmt.kind === 'IfStatement' || stmt.kind === 'WhileStatement';
                const isPrevBlock = prevStmt.kind === 'IfStatement' || prevStmt.kind === 'WhileStatement';

                if (isCurrentBlock || isPrevBlock) {
                    lines.push('');
                }
            }

            lines.push(...this.renderStatement(stmt, depth + 1));
        }

        lines.push(this.indent(depth) + '}');
        return lines;
    }

    // -------------------------------------------------------------------------
    // Statement dispatcher
    // -------------------------------------------------------------------------

    renderStatement(stmt: StatementNode, depth: number): string[] {
        switch (stmt.kind) {
            case 'FunctionDeclaration':
                return this.renderFunction(stmt, depth);

            case 'IfStatement':
                return this.renderIfStatement(stmt, depth);

            case 'WhileStatement':
                return this.renderWhileStatement(stmt, depth);

            case 'VariableDeclaration':
                return [this.indent(depth) + `local ${stmt.name} = ${exprToString(stmt.init)};`];

            case 'ExpressionStatement':
                return [this.indent(depth) + exprToString(stmt.expression) + ';'];

            case 'PrintStatement': {
                const args = [stmt.format, ...stmt.args].map(exprToString).join(', ');
                return [this.indent(depth) + `print(${args});`];
            }

            case 'ShowMessageBoxStatement': {
                const args = [stmt.format, ...stmt.args].map(exprToString).join(', ');
                return [this.indent(depth) + `showMessageBox(${args});`];
            }

            case 'InitializeChildThreadStatement':
                return this.renderThreadScope('initializeChildThread', stmt.unk1, stmt.body, depth);

            case 'AddChildThreadStatement':
                return this.renderThreadScope('addChildThread', stmt.unk1, stmt.body, depth);

            case 'UnknownStatement':
                return [this.indent(depth) + `func_${stmt.opcodeHex}(${stmt.args.join(', ')});`];
        }
    }

    // -------------------------------------------------------------------------
    // Compound statements
    // -------------------------------------------------------------------------

    private renderThreadScope(
        keyword: string,
        unk: ExpressionNode,
        body: BlockStatementNode,
        depth: number
    ): string[] {
        const lines: string[] = [];
        // Change: removed the space before the parenthesis
        lines.push(this.indent(depth) + `${keyword}(${exprToString(unk)})`);
        lines.push(...this.renderBlock(body, depth));
        return lines;
    }

    renderIfStatement(node: IfStatementNode, depth: number): string[] {
        const lines: string[] = [];

        // Render the "if (...)" header
        lines.push(this.indent(depth) + `if (${exprToString(node.condition)})`);

        // Render the consequent block (adds { and })
        lines.push(...this.renderBlock(node.consequent, depth));

        // Handle else / else-if chains
        if (node.alternate) {
            // Remove the closing `}` to merge it with the `else` keyword
            const lastBracketLine = lines.pop()!;

            if (node.alternate.kind === 'IfStatement') {
                // Case: "} else if (...)"
                const elseIfNode = node.alternate as IfStatementNode;
                lines.push(`${lastBracketLine.trimEnd()} else if (${exprToString(elseIfNode.condition)})`);

                // Recursive call, but the first line of the sub-if statement (already written above) is ignored.
                const subIfLines = this.renderIfStatement(elseIfNode, depth);
                subIfLines.shift();
                lines.push(...subIfLines);
            } else {
                // Case: "} else"
                lines.push(`${lastBracketLine.trimEnd()} else`);
                lines.push(...this.renderBlock(node.alternate as BlockStatementNode, depth));
            }
        }

        return lines;
    }

    renderWhileStatement(node: WhileStatementNode, depth: number): string[] {
        const lines: string[] = [];
        lines.push(this.indent(depth) + `while (${exprToString(node.condition)})`);
        lines.push(...this.renderBlock(node.body, depth));
        return lines;
    }

    // -------------------------------------------------------------------------
    // Indentation helper
    // -------------------------------------------------------------------------

    private indent(depth: number): string {
        return ' '.repeat(depth * this.indentSize);
    }
}

// #endregion

// #region Shared helpers (kept in sync with imageExporter)

/**
 * Converts an {@link ExpressionNode} to its source-like string representation.
 *
 * @param expr - The expression node to stringify.
 * @returns A human-readable string for the expression.
 */
function exprToString(expr: ExpressionNode): string {
    switch (expr.kind) {
        case 'Literal':
            return expr.isHalfFloat ? expr.value.toFixed(4) : String(expr.value);
        case 'VariableRef':
            return expr.name;
        case 'StringRef':
            return `"${expr.display}"`;
        case 'BinaryExpression':
            return `${exprToString(expr.left)} ${expr.operator} ${exprToString(expr.right)}`;
        case 'CallExpression':
            return `${expr.name}(${expr.args.map(exprToString).join(', ')})`;
    }
}

/**
 * Finds a {@link FunctionDeclarationNode} by name inside a program's top-level body.
 *
 * @param program - The program to search.
 * @param name    - The function name to look up.
 * @returns The matching node, or `null` if not found.
 */
function findFunction(program: ProgramNode, name: string): FunctionDeclarationNode | null {
    for (const node of program.body) {
        if (node.kind === 'FunctionDeclaration' && node.name === name) return node;
    }
    return null;
}

// #endregion