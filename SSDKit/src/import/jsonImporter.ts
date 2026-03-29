import * as fs from 'fs';
import type { ProgramNode } from '../types/astNode';

/**
 * Parses JSON text into a {@link ProgramNode}.
 * Throws if the root object is not a `Program` AST node.
 */
export function parseProgramFromJSON(jsonText: string): ProgramNode {
  const data = JSON.parse(jsonText) as ProgramNode;
  if (!data || data.kind !== 'Program') {
    throw new Error('jsonImporter: root JSON value must be a Program AST node (`kind: "Program"`).');
  }
  return data;
}

/**
 * Reads a UTF-8 file and parses it as a {@link ProgramNode}.
 */
export function parseProgramFromJSONFile(filePath: string): ProgramNode {
  const text = fs.readFileSync(filePath, 'utf8');
  return parseProgramFromJSON(text);
}
