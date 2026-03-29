# SSDVsExtension

VSCode extension for editing SSD (Scene Script Data) scripts with full language support and SSDKit integration.

## Installation and Building

```bash
npm install
vsce package
```

Answer `y` to all questions during the packaging process. Note that `vsce package` automatically rebuilds SSDKit.

## Features

### Language Support

The extension provides complete support for the Scene Script Data language:

- **Syntax Highlighting**: Highlighting of keywords, functions, variables, and strings
- **Auto-completion**: Suggestion of available functions with their parameters
- **Contextual Help**: Information on functions when hovering the cursor
- **Smart Snippets**: Automatic generation of function signatures with placeholders

### File Management

#### Automatic Decompilation
When opening a binary SSD file:
- Automatic detection of binary SSD files (magic bytes `SSD\0`)
- Automatic decompilation to editable text format
- Creation of a `{name}.decomp.ssd` file in the same directory
- Automatic opening of the decompiled file

#### Integrated Compilation
- **Status bar button**: One-click compilation
- **Command `sceneScriptData.compile`**: Compiles the current file
- **Automatic generation**: Creates `{name}.compiled.ssd` and `{name}.compiled.sst` files
- **Error messages**: Detailed compilation error display

### Configuration

#### SSDKit Resolution
The extension searches for SSDKit CLI in this order:
1. Custom path via `sceneScriptData.ssdKitPath`
2. Sibling SSDKit folder (monorepo)
3. `node_modules/ssd-toolchain` (npm package)

#### VSCode Settings
```json
{
  "sceneScriptData.ssdKitPath": ""
}
```

### Available Commands

#### `sceneScriptData.compile`
Compiles the current SSD file to binary.
- Automatic save if the file is modified
- Generates `.compiled.ssd` and `.compiled.sst` files
- Shows success or error messages

#### `sceneScriptData.decompile`
Manually decompiles the current binary file.
- Useful for files that weren't automatically redirected

#### `sceneScriptData.chooseSstCompanion`
Allows selecting a companion SST file for an SSD file.

### File Associations

The extension automatically associates the following extensions with the "Scene Script Data" language:

* `.ssd.json`: AST JSON files
* `.ssd`: SSD files (can be either compiled or decompiled versions)
* `.pac_`: Compiled SSD files (obtained using Tinke)


### Editor Integration

#### Status Bar
- Compilation icon visible only for SSD files
- Tooltip indicating compilation function
- Shortcut to compilation command

#### Smart Redirection
- Automatic detection of binary SSD files
- Replacement of binary view with editable text view
- Maintains consistency between binary and decompiled files

#### Multi-file Support
- Management of SSD/SST pairs
- Tracking changes between source and compiled files

### Technical Architecture

#### File Structure
```
SSDVsExtension/
├── src/
│   ├── extension.ts          # Main entry point
│   └── syntaxes/             # Syntax highlighting files
├── package.json              # Extension configuration
└── language-configuration.json # Language configuration
```

#### Dependencies
- `ssd-toolchain`: Local package containing SSDKit
- TypeScript: Static typing and compilation
- VSCode API: Editor integration

#### Workflow
1. **Opening**: Binary detection → Decompilation → Redirection
2. **Editing**: Language support → Auto-completion → Contextual help
3. **Compilation**: Save → SSDKit call → File generation

### Customization

#### Themes and Highlighting
Syntax highlighting is defined in `syntaxes/scene-script-data.tmLanguage.json`:
- Language keywords
- Data types
- System functions
- String literals
- Comments

#### Language Configuration
The `language-configuration.json` file defines:
- Comment characters
- Bracket pairs ( { }, ( ), [ ] )
- Auto-closing quotes

### Development

#### Build Process
```bash
npm run build-all      # Build SSDKit + package + compilation
npm run build-toolchain # Build SSDKit only
npm run update-toolchain # Update local dependency
npm run compile        # TypeScript compilation of extension
npm run watch         # Development mode with watching
```

#### Code Structure
- **Modularity**: Clear separation of responsibilities
- **Type Safety**: Complete TypeScript typing
- **Error Handling**: Robust error management
- **Performance**: Optimized file operations

### Troubleshooting

#### Common Issues
- **SSDKit not found**: Check `sceneScriptData.ssdKitPath` configuration
- **Compilation failure**: Check VSCode console for detailed errors
- **Unrecognized files**: Verify extensions and magic bytes

#### Logs and Debug
- Messages in VSCode console (Developer Tools)
- Output channel for compilation operations
- Detailed information in tooltips

## Project Status

**This project is currently under development.** Errors may occur during use. Features and user interface are constantly evolving.
