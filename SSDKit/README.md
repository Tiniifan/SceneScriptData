# SSDKit

Main TypeScript library for analyzing and manipulating SSD (Scene Script Data) files.

## Installation and Building

```bash
npm install
npm run build
```

After building, the CLI is accessible via `node dist/cli.js`.

## CLI - Features

The SSDKit CLI provides the following commands for SSD file manipulation:

### `info <file>`
Displays SSD file header information.
- Magic bytes
- File version
- Total size
- Instruction and text entry counts
- Instruction and text block sizes

### `dump <file>`
Exports raw instructions as a formatted table with:
- Instruction index
- Hexadecimal ID
- Instruction type
- Instruction name
- Argument types
- Hexadecimal argument values

### `parse <file>`
Parses an SSD file and exports the AST as JSON.
Options:
- `-o, --output <path>`: Write JSON to a file
- `-f, --function <name>`: Export only the specified function
- `-s, --sst <path>`: Force use of a specific SST file
- `--indent <n>`: JSON indentation spaces (default: 2)

### `text <file>`
Displays the AST as structured hierarchical text.
Options:
- `-o, --output <path>`: Write text to a file
- `-f, --function <name>`: Display only the specified function
- `-s, --sst <path>`: Force use of a specific SST file
- `--indent <n>`: Spaces per indentation level (default: 2)

### `image <file>`
Exports the AST (or a function) as an SVG image.
Options:
- `-o, --output <path>`: SVG output path (default: <file>.svg)
- `-f, --function <name>`: Render only the specified function
- `-s, --sst <path>`: Force use of a specific SST file

### `text-to-json <file>`
Converts a text SSD file to JSON AST format.
Options:
- `-o, --output <path>`: Write JSON to a file
- `-f, --function <name>`: Export only the specified function
- `--indent <n>`: JSON indentation spaces (default: 2)

### `compile <file>`
Compiles an AST file (JSON or Text) to binary SSD.
Options:
- `--no-sst`: Do not write the companion SST file
- `-o, --output-base <path>`: Output base path

### `registry`
Displays all registered instruction definitions as JSON.

## Architecture

The project is structured into several modules:

- **ast/**: AST construction and manipulation
- **binary/**: Binary structure reading/writing
- **compile/**: AST to binary compilation
- **compiler/**: Compilation logic
- **export/**: Export in various formats (JSON, SVG, text)
- **import/**: Import from various formats
- **reader/**: SSD and SST file readers
- **registry/**: Instruction registry
- **types/**: TypeScript type definitions
- **writer/**: Compiled file writing

## Adding a Call Type Function

To add a new Call type function, modify the `src/registry/instructions.yml` file:

1. Locate the `Call:` section in the YAML file
2. Add a new entry with the following format:

```yaml
  - opcode: 0xXXXX  # Unique hexadecimal opcode
    name: FunctionName
    syntax: functionName  # Syntax used in decompiled code
    description: |
      Detailed description of what the function does.
      Can span multiple lines.
    params:
      - name: param1
        description: Description of the first parameter
      - name: param2
        description: Description of the second parameter
        optional: true  # Mark as optional if applicable
```

3. Required fields are:
   - `opcode`: Unique hexadecimal value (0x1000 to 0xFFFF)
   - `name`: Internal function name
   - `syntax`: Syntax used in decompiled code
   - `description`: Function description

4. Optional parameters:
   - `params`: List of parameters with descriptions
   - Each parameter can have `optional: true`

5. After modification, rebuild with `npm run build`

## Instruction Registry

The system uses a centralized registry for all SSD instructions, organized by categories:

- **Function**: Function declarations
- **Block**: Block structures ({ and })
- **ControlFlow**: Control flow instructions (if, while, etc.)
- **Variable**: Local variable management
- **Call**: System function calls
- **Operator**: Arithmetic and logical operators

## Project Status

**This project is currently under development.** Errors may occur during use. The API and file formats may evolve.

## Dependencies

- `commander`: CLI interface
- `iconv-lite`: Text encoding conversion
- `js-yaml`: YAML configuration file parsing
