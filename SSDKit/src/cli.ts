//#region Imports
import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';

import { SSDReader } from './reader/ssdReader';
import { SSTReader } from './reader/sstReader';
import { createDefaultRegistry } from './registry/builtinInstructions';
import { buildAST } from './ast/astBuilder';
import { exportToJSONFile } from './export/jsonExporter';
import { exportToSVGFile } from './export/imageExporter';
import { exportToText, exportToTextFile } from './export/textExporter';
import { parseProgramFromJSONFile } from './import/jsonImporter';
import { parseProgramFromText, parseProgramFromTextFile } from './import/textImporter';
import { writeCompiledFiles } from './compile/compileFromAst';
//#endregion

//#region CLI Configuration
const program = new Command();

program
    .name('ssd')
    .description('SSD binary script toolchain — parse, inspect, and visualise .ssd files')
    .version('0.1.0');
//#endregion

//#region Command: info
program
    .command('info <file>')
    .description('Display header information for an SSD file')
    .action((file: string) => {
        const buffer = readFile(file);
        const reader = new SSDReader(buffer);
        const data = reader.read();
        const h = data.header;

        console.log('--- SSD Header ---');
        console.log(`  Magic      : ${h.magic}`);
        console.log(`  Version    : ${h.version}`);
        console.log(`  File size  : ${h.size} bytes`);
        console.log(`  Instructions: ${h.instCount}`);
        console.log(`  Text entries: ${h.textCount}`);
        console.log(`  Inst block : ${h.instSize} bytes`);
        console.log(`  Text block : ${h.textSize} bytes`);
    });
//#endregion

//#region Command: dump
program
    .command('dump <file>')
    .description('Dump raw instructions to stdout as a table')
    .action((file: string) => {
        const buffer = readFile(file);
        const reader = new SSDReader(buffer);
        const data = reader.read();
        const registry = createDefaultRegistry();

        console.log(`#    ID   TYPE    NAME                     ARGS  ARG_TYPES                   VALUES`);
        console.log(`${'─'.repeat(100)}`);

        for (const inst of data.instructions) {
            const def = registry.get(inst.type);

            const idx      = String(inst.index).padStart(4, ' ');
            const id       = `0x${inst.id.toString(16).toUpperCase().padStart(4, '0')}`;
            const type     = `0x${inst.type.toString(16).toUpperCase().padStart(4, '0')}`;
            const name     = (def?.name ?? 'UNKNOWN').padEnd(24, ' ');
            const argTypes = inst.argTypes.map((a) => a.name).join(', ').padEnd(28, ' ');
            const args     = inst.args.map((a) => `0x${a.toString(16).toUpperCase()}`).join(' ');

            console.log(`${idx} ${id}  ${type}  ${name} ${inst.argsCount}    ${argTypes} ${args}`);
        }
    });
//#endregion

//#region Command: parse
program
    .command('parse <file>')
    .description('Parse an SSD file and output the AST as JSON')
    .option('-o, --output <path>', 'Write JSON to a file instead of stdout')
    .option('-f, --function <name>', 'Only output the named function node')
    .option('-s, --sst <path>', 'Force use of a specific .sst text file')
    .option('--indent <n>', 'JSON indentation spaces (default: 2)', '2')
    .action((file: string, opts: { output?: string; function?: string; indent: string; sst?: string }) => {
        const buffer   = readFile(file);
        const registry = createDefaultRegistry();
        const reader   = new SSDReader(buffer);
        const ssdFile  = reader.read();

        const sstPath = opts.sst ?? replaceExtension(file, '.sst');
        let sstFile = undefined;
        if (fs.existsSync(sstPath)) {
            const sstBuffer = fs.readFileSync(sstPath);
            sstFile = new SSTReader(sstBuffer).read();
        }

        const ast          = buildAST(ssdFile, registry, sstFile);
        const indent       = parseInt(opts.indent, 10);
        const functionName = opts.function;
        const outputPath   = opts.output;

        if (outputPath) {
            exportToJSONFile(ast, outputPath, { indent, functionName });
            console.log(`JSON written to: ${outputPath}`);
        } else {
            const { exportToJSON } = require('./export/jsonExporter');
            console.log(exportToJSON(ast, { indent, functionName }));
        }
    });
//#endregion

//#region Command: text
program
    .command('text <file>')
    .description('Print the AST as indented plain text (same hierarchy as the SVG image view)')
    .option('-o, --output <path>', 'Write text to a file instead of stdout')
    .option('-f, --function <name>', 'Only output the named function')
    .option('-s, --sst <path>', 'Force use of a specific .sst text file')
    .option('--indent <n>', 'Spaces per indentation level (default: 2)', '2')
    .action((file: string, opts: { output?: string; function?: string; sst?: string; indent: string }) => {
        const buffer   = readFile(file);
        const registry = createDefaultRegistry();
        const reader   = new SSDReader(buffer);
        const ssdFile  = reader.read();

        const sstPath = opts.sst ?? replaceExtension(file, '.sst');
        let sstFile = undefined;
        if (fs.existsSync(sstPath)) {
            const sstBuffer = fs.readFileSync(sstPath);
            sstFile = new SSTReader(sstBuffer).read();
        }

        const ast          = buildAST(ssdFile, registry, sstFile);
        const indentSize   = parseInt(opts.indent, 10);
        const functionName = opts.function;
        const outputPath   = opts.output;

        if (outputPath) {
            exportToTextFile(ast, outputPath, { indentSize, functionName });
            console.log(`Text written to: ${outputPath}`);
        } else {
            console.log(exportToText(ast, { indentSize, functionName }));
        }
    });
//#endregion

//#region Command: image
program
    .command('image <file>')
    .description('Export the AST (or a single function) as an SVG image')
    .option('-o, --output <path>', 'Output SVG path (default: <file>.svg)')
    .option('-f, --function <name>', 'Only render the named function')
    .option('-s, --sst <path>', 'Force use of a specific .sst text file')
    .action((file: string, opts: { output?: string; function?: string; sst?: string }) => {
        const buffer   = readFile(file);
        const registry = createDefaultRegistry();
        const reader   = new SSDReader(buffer);
        const ssdFile  = reader.read();

        const sstPath = opts.sst ?? replaceExtension(file, '.sst');
        let sstFile = undefined;
        if (fs.existsSync(sstPath)) {
            const sstBuffer = fs.readFileSync(sstPath);
            sstFile = new SSTReader(sstBuffer).read();
        }

        const ast        = buildAST(ssdFile, registry, sstFile);
        const outputPath = opts.output ?? replaceExtension(file, '.svg');
        exportToSVGFile(ast, outputPath, { functionName: opts.function });
        console.log(`SVG written to: ${outputPath}`);
    });
//#endregion

//#region Command: text-to-json
program
    .command('text-to-json <file>')
    .description('Convert plain-text SSD file to AST JSON format')
    .option('-o, --output <path>', 'Write JSON to a file instead of stdout')
    .option('-f, --function <name>', 'Only output the named function')
    .option('--indent <n>', 'JSON indentation spaces (default: 2)', '2')
    .action((file: string, opts: { output?: string; function?: string; indent: string }) => {
        const text = fs.readFileSync(file, 'utf8');
        const program = parseProgramFromText(text, { functionName: opts.function });
        const indent = parseInt(opts.indent, 10);
        const json = JSON.stringify(program, null, indent);
        
        if (opts.output) {
            fs.writeFileSync(opts.output, json, 'utf8');
            console.log(`JSON written to: ${opts.output}`);
        } else {
            console.log(json);
        }
    });
//#endregion

//#region Command: compile
program
    .command('compile <file>')
    .description('Compile an AST file (JSON or Text) into binary SSD')
    .option('--no-sst', 'Do not write the companion .sst file')
    .option('-o, --output-base <path>', 'Output base path')
    .action((file: string, opts: { sst?: boolean; outputBase?: string }) => {
        const filePath = readFilePath(file);
        const isText = filePath.toLowerCase().endsWith('.ssd') || filePath.toLowerCase().endsWith('.decomp.ssd');
        
        // Choose the correct parser based on file extension
        const ast = isText 
            ? parseProgramFromTextFile(filePath) 
            : parseProgramFromJSONFile(filePath);

        const base =
            opts.outputBase ??
            path.join(path.dirname(path.resolve(file)), astStemFromInputFile(file));
        
        const skipSst = opts.sst === false;
        const { ssdPath, sstPath } = writeCompiledFiles(ast, { outputBasePath: base, registry: createDefaultRegistry(), skipSst });

        console.log(`SSD written to: ${ssdPath}`);
        if (!skipSst && sstPath) {
            console.log(`SST written to: ${sstPath}`);
        }
    });
//#endregion

//#region Command: registry
program
    .command('registry')
    .description('Print all registered instruction definitions as JSON')
    .action(() => {
        const registry = createDefaultRegistry();
        console.log(JSON.stringify(registry.toJSON(), null, 2));
    });
//#endregion

//#region Helpers
function readFile(filePath: string): Buffer {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
        console.error(`File not found: ${resolved}`);
        process.exit(1);
    }
    return fs.readFileSync(resolved);
}

function readFilePath(filePath: string): string {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
        console.error(`File not found: ${resolved}`);
        process.exit(1);
    }
    return resolved;
}

/**
 * Derives the output stem from an AST JSON path (`battle.ssd.json` → `battle`).
 */
function astStemFromInputFile(filePath: string): string {
    const base = path.basename(filePath);
    if (base.toLowerCase().endsWith('.ssd.json')) return base.slice(0, -'.ssd.json'.length);
    if (base.toLowerCase().endsWith('.json'))     return base.slice(0, -'.json'.length);
    return path.basename(filePath, path.extname(filePath));
}

function replaceExtension(filePath: string, ext: string): string {
    const base = path.basename(filePath, path.extname(filePath));
    return path.join(path.dirname(filePath), base + ext);
}
//#endregion

program.parse(process.argv);