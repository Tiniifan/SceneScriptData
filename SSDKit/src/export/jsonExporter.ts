import * as fs     from 'fs';
import * as path   from 'path';
import { ProgramNode, FunctionDeclarationNode } from '../types/astNode';

export interface JSONExportOptions {
  /** Number of spaces for indentation (default: 2) */
  indent?: number;
  /** If set, only export the function with this name */
  functionName?: string;
}

/**
 * Serialises a ProgramNode (or a single function within it) to a JSON string.
 */
export function exportToJSON(program: ProgramNode, options: JSONExportOptions = {}): string {
  const indent = options.indent ?? 2;

  if (options.functionName) {
    const fn = findFunction(program, options.functionName);
    if (!fn) throw new Error(`Function "${options.functionName}" not found in the AST.`);
    return JSON.stringify(fn, null, indent);
  }

  return JSON.stringify(program, null, indent);
}

/**
 * Writes the JSON representation to a file and returns the output path.
 */
export function exportToJSONFile(
  program:    ProgramNode,
  outputPath: string,
  options:    JSONExportOptions = {}
): string {
  const json = exportToJSON(program, options);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, json, 'utf8');
  return outputPath;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findFunction(program: ProgramNode, name: string): FunctionDeclarationNode | null {
  for (const node of program.body) {
    if (node.kind === 'FunctionDeclaration' && node.name === name) return node;
  }
  return null;
}