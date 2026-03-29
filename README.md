# SceneScriptData

Tool suite for analyzing and manipulating SSD (Scene Script Data) files used in Inazuma Eleven games on Nintendo DS.

## Overview

SSD files are compiled scripts from a proprietary language developed by Level-5 for the Inazuma Eleven series. This project provides a complete toolchain for:

- Parsing and analyzing binary SSD files
- Decompiling scripts into readable format
- Recompiling modified scripts
- Visualizing program structure through graphical exports

## Project Structure

```
SceneScriptData/
├── SSDKit/           # Main TypeScript library
└── SSDVsExtension/   # VSCode extension
```

## Building

### SSDKit

```bash
cd SSDKit
npm install
npm run build
```

This command creates a `dist` folder containing the CLI accessible via `node dist/cli.js`.

### SSDVsExtension

```bash
cd SSDVsExtension
npm install
vsce package
```

Answer `y` to all questions during the packaging process. Note that this command automatically rebuilds SSDKit.

## Decompiled Code Example

Here's an example of a decompiled SSD script to illustrate the output format:

```
SSD Program  (version 196609)
  function func_0x2000()
  {
    // Comment
    local var_0x20003 = func_0x7009(25040000, func_0x40D9(func_0x4027()));
    print("■MapSetting : %8d", var_0x20003);

    if (func_0x7002(func_0x40B7(var_0x20003)))
    {
      local var_0x20003 = 25040000;
      print("■■MapSetting : %8d", var_0x20003);
    }

    func_0x3003(1, 131075, 8192);
  }

  function func_0x2001()
  {
    local var_0x20003 = func_0x7009(25020000, func_0x40D9(func_0x4027()));
    print("■NPCSet : %8d", var_0x20003);
    func_0x3003(1, 131075, 8192);
  }
```

## Project Status

**This project is currently under development.** Errors may occur during use. Documentation and features are constantly evolving.

## Components

- **SSDKit**: Main TypeScript library for SSD file manipulation
- **SSDVsExtension**: VSCode extension providing integrated interface for SSD script editing

For more information on each component, consult the specific README files in their respective folders.
