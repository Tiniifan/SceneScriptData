import * as fs from 'fs';
import * as path from 'path';
import { compileAST, CompileASTOptions } from '../compiler/astCompiler';
import type { ProgramNode } from '../types/astNode';
import { writeSSDBuffer } from '../writer/ssdWriter';
import { writeSSTBuffer } from '../writer/sstWriter';

/**
 * Options for writing compiled SSD / SST files to disk.
 */
export interface WriteCompiledFilesOptions extends CompileASTOptions {
  /** Base path for outputs (directory + stem, without `_compiled` / `.sst` suffix). */
  outputBasePath: string;
}

/**
 * Compiles an AST and writes `{stem}.compiled.ssd` plus `{stem}.compiled.sst` next to the chosen base path,
 * unless {@link CompileASTOptions.skipSst} is set.
 */
export function writeCompiledFiles(program: ProgramNode, opts: WriteCompiledFilesOptions): {
  ssdPath: string;
  sstPath?: string;
} {
  const { ssdFile, sstEntries } = compileAST(program, opts);
  const dir = path.dirname(opts.outputBasePath);
  const stem = path.basename(opts.outputBasePath);
  fs.mkdirSync(dir, { recursive: true });

  const ssdPath = path.join(dir, `${stem}.compiled.ssd`);
  fs.writeFileSync(ssdPath, writeSSDBuffer(ssdFile));

  if (opts.skipSst) {
    return { ssdPath };
  }

  const sstPath = path.join(dir, `${stem}.compiled.sst`);
  fs.writeFileSync(sstPath, writeSSTBuffer(sstEntries));
  
  return { ssdPath, sstPath };
}
