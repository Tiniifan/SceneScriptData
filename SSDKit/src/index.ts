// Core reader
export { SSDReader }            from './reader/ssdReader';
export { SSTReader, SSTFile }    from './reader/sstReader';
export type { SSTEntry }        from './reader/sstReader';

// Types
export * from './types/argType';
export * from './types/instructionDef';
export * from './types/rawInstruction';
export * from './types/astNode';

// Registry
export { InstructionRegistry }      from './registry/instructionRegistry';
export { BUILTIN_INSTRUCTIONS,
         createDefaultRegistry }    from './registry/builtinInstructions';

// AST
export { ASTBuilder, buildAST }     from './ast/astBuilder';

// Exporters
export { exportToJSON,
         exportToJSONFile }         from './export/jsonExporter';
export { exportToSVG,
         exportToSVGFile }          from './export/imageExporter';

// JSON import + compile pipeline
export { parseProgramFromJSON,
         parseProgramFromJSONFile } from './import/jsonImporter';
export { parseProgramFromText,
         parseProgramFromTextFile } from './import/textImporter';
export { compileAST }                from './compiler/astCompiler';
export type { CompileASTOptions,
              CompileASTResult }   from './compiler/astCompiler';
export { writeSSDBuffer,
         buildSSDHeader,
         makeRawInstruction }      from './writer/ssdWriter';
export { writeSSTBuffer }           from './writer/sstWriter';
export type { SSTWriteEntry }       from './writer/sstWriter';
export { writeCompiledFiles }       from './compile/compileFromAst';
export type { WriteCompiledFilesOptions } from './compile/compileFromAst';