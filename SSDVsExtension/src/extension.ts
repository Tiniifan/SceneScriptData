import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { createDefaultRegistry, InstructionCategory } from 'ssd-toolchain';

// #region Constants

/** SSD binary magic bytes: 'S' 'S' 'D' 0x00 */
const SSD_MAGIC = [0x53, 0x53, 0x44, 0x00] as const;

/** Extension added to decompiled files to make them editable. */
const DECOMP_EXT = '.decomp.ssd';

const registry = createDefaultRegistry();

// #endregion

// #region Helpers

/**
 * Checks whether the given file is a compiled SSD binary by reading its
 * first 4 bytes and comparing them against the magic header `SSD\0`.
 *
 * @param filePath - Absolute path to the file to inspect.
 * @returns `true` if the file starts with the SSD magic bytes, `false` otherwise.
 */
function isBinarySsd(filePath: string): boolean {
  try {
    if (!fs.existsSync(filePath)) return false;
    const buffer = Buffer.alloc(4);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buffer, 0, 4, 0);
    fs.closeSync(fd);
    return SSD_MAGIC.every((byte, i) => buffer[i] === byte);
  } catch {
    return false;
  }
}

/**
 * Resolves the absolute path to the SSDKit CLI entry point (`dist/cli.js`).
 *
 * Resolution order:
 * 1. User-configured path via `sceneScriptData.ssdKitPath` setting.
 * 2. Sibling `SSDKit` folder relative to the extension root (monorepo layout).
 * 3. Local `node_modules/ssd-toolchain` (npm-installed package).
 *
 * @returns The resolved path to `cli.js`, or `null` if none was found.
 */
function resolveSsdKitCli(): string | null {
  const cfg = vscode.workspace.getConfiguration('sceneScriptData');
  const custom = (cfg.get<string>('ssdKitPath') ?? '').trim();

  if (custom) {
    const cli = path.join(custom, 'dist', 'cli.js');
    if (fs.existsSync(cli)) return cli;
  }

  const fromRepoRoot = path.join(__dirname, '..', '..', 'SSDKit', 'dist', 'cli.js');
  if (fs.existsSync(fromRepoRoot)) return fromRepoRoot;

  const fromNodeModules = path.join(__dirname, '..', 'node_modules', 'ssd-toolchain', 'dist', 'cli.js');
  if (fs.existsSync(fromNodeModules)) return fromNodeModules;

  return null;
}

/**
 * Derives the file stem (name without extension) from an editor file path.
 *
 * Examples:
 * - `battle.ssd`      -> `battle`
 * - `battle.pac_`     -> `battle`
 * - `battle.decomp.ssd` -> `battle`
 *
 * @param filePath - The file path to extract the stem from.
 * @returns The base name without known SSD extensions.
 */
function astStemFromEditorPath(filePath: string): string {
  let base = path.basename(filePath);

  // List of strings to strip from the end of the filename
  // Order matters: check longer/specific ones first
  const toStrip = [
    '.decomp.ssd',
    '.compiled.ssd',
    '.compiled.sst',
    '.ssd.json',
    '.ssd',
    '.pac_'
  ];

  let changed = true;
  while (changed) {
    changed = false;
    const lowerBase = base.toLowerCase();
    for (const ext of toStrip) {
      if (lowerBase.endsWith(ext)) {
        base = base.slice(0, -ext.length);
        changed = true;
        break; // Re-check from the beginning of the list
      }
    }
  }

  return base;
}

// #endregion

// #region Decompilation

/**
 * Spawns the SSDKit CLI to decompile a binary SSD file and returns 
 * the resulting plain-text script.
 *
 * @param filePath - Absolute path to the binary `.ssd` or `.pac_` file.
 * @returns A promise resolving to the script string.
 */
function runDecompile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const cli = resolveSsdKitCli();
    if (!cli) {
      return reject("SSDKit (cli.js) not found. Check extension settings.");
    }

    const proc = spawn('node', [cli, 'text', filePath], {
      shell: process.platform === 'win32',
    });

    let output = '';
    let error = '';
    proc.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    proc.stderr?.on('data', (chunk: Buffer) => { error += chunk.toString(); });

    proc.on('close', (code) => {
      if (code === 0) resolve(output);
      else reject(`Decompilation failed (exit code ${code}): ${error.trim()}`);
    });
  });
}

// #endregion

// #region Compilation

/**
 * Compiles a script file into a binary SSD by invoking the SSDKit CLI.
 *
 * @param inputPath - Absolute path to the source script file.
 */
function runCompile(inputPath: string): void {
  const cli = resolveSsdKitCli();
  if (!cli) {
    void vscode.window.showErrorMessage('SSDKit (dist/cli.js) not found.');
    return;
  }

  const stem = astStemFromEditorPath(inputPath);
  const outBase = path.join(path.dirname(inputPath), stem);

  const proc = spawn('node', [cli, 'compile', inputPath, '-o', outBase], {
    cwd: path.dirname(inputPath),
    shell: process.platform === 'win32',
  });

  let stderr = '';
  proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

  proc.on('close', (code) => {
    if (code === 0) {
      void vscode.window.showInformationMessage(`Compilation successful: ${stem}.compiled.ssd`);
    } else {
      void vscode.window.showErrorMessage(`Compilation failed (exit code ${code}): ${stderr.trim()}`);
    }
  });
}

// #endregion

// #region Extension Lifecycle

/**
 * Extension entry point.
 */
export function activate(context: vscode.ExtensionContext): void {
  // Register language providers
  context.subscriptions.push(hoverProvider);
  context.subscriptions.push(completionProvider);

  // #region Status Bar

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = 'sceneScriptData.compile';
  status.text = '$(package) Compile';
  status.tooltip = 'Compile the active SSD file';

  function refreshStatus(): void {
    const ed = vscode.window.activeTextEditor;
    if (!ed) { status.hide(); return; }

    const doc = ed.document;
    const fn = doc.fileName.toLowerCase();
    const isSsd =
      doc.languageId === 'scene-script-data' ||
      fn.endsWith('.ssd') ||
      fn.endsWith('.pac_') ||
      fn.endsWith(DECOMP_EXT);

    if (isSsd) status.show(); else status.hide();
  }

  // #endregion

  // #region Redirection Logic

  /**
   * Main redirection logic: 
   * Detects binary files and generates an editable {stem}.decomp.ssd file.
   */
  const checkAndRedirect = async (editor: vscode.TextEditor | undefined): Promise<void> => {
    if (!editor) return;

    const doc = editor.document;
    const fp = doc.uri.fsPath;

    // Prevent recursive redirection
    if (fp.toLowerCase().endsWith(DECOMP_EXT)) return;

    const isPhysicalSsdFile =
      (fp.toLowerCase().endsWith('.ssd') || fp.toLowerCase().endsWith('.pac_')) &&
      doc.uri.scheme === 'file';

    if (!isPhysicalSsdFile || !isBinarySsd(fp)) return;

    // FIX: Generate "filename.decomp.ssd" by stripping the original extension
    const stem = astStemFromEditorPath(fp);
    const decompPath = path.join(path.dirname(fp), stem + DECOMP_EXT);

    try {
      const content = await runDecompile(fp);

      // Write to disk as a physical file
      fs.writeFileSync(decompPath, content, 'utf8');

      // Close the original binary view
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

      // Open the new editable file
      const newDoc = await vscode.workspace.openTextDocument(decompPath);
      await vscode.languages.setTextDocumentLanguage(newDoc, 'scene-script-data');
      await vscode.window.showTextDocument(newDoc, { preview: false });

    } catch (err) {
      void vscode.window.showErrorMessage("Decompilation error: " + err);
    }
  };

  // #endregion

  // #region Event Listeners

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      void checkAndRedirect(editor);
      refreshStatus();
    })
  );

  // #endregion

  // #region Commands

  context.subscriptions.push(
    vscode.commands.registerCommand('sceneScriptData.compile', async () => {
      const ed = vscode.window.activeTextEditor;
      if (!ed) return;

      const doc = ed.document;
      if (doc.isDirty) await doc.save();

      runCompile(doc.fileName);
    }),

    vscode.commands.registerCommand('sceneScriptData.decompile', async () => {
      const ed = vscode.window.activeTextEditor;
      if (!ed) return;
      void checkAndRedirect(ed);
    })
  );

  // #endregion

  context.subscriptions.push(status);

  void checkAndRedirect(vscode.window.activeTextEditor);
  refreshStatus();
}

const hoverProvider = vscode.languages.registerHoverProvider('scene-script-data', {
  provideHover(document, position) {
    const range = document.getWordRangeAtPosition(position);
    if (!range) return null;
    const word = document.getText(range);

    // Strict: We only search by the 'syntax' keyword
    const instruction = registry.getAll().find(ins => ins.syntax === word);

    if (instruction && instruction.category === InstructionCategory.Call) {
      const markdown = new vscode.MarkdownString();
      markdown.appendMarkdown(`### Instruction: \`${instruction.syntax}\`\n`);
      markdown.appendMarkdown(`*Opcode: 0x${instruction.opcode.toString(16).toUpperCase()}*\n\n`);
      markdown.appendMarkdown(`${instruction.description}\n\n`);

      if (instruction.params && instruction.params.length > 0) {
        markdown.appendMarkdown(`**Paramètres :**\n`);
        instruction.params.forEach(p => {
          markdown.appendMarkdown(`- **${p.name}** : ${p.description}${p.optional ? ' *(optionnel)*' : ''}\n`);
        });
      }
      return new vscode.Hover(markdown);
    }
    return null;
  }
});

const completionProvider = vscode.languages.registerCompletionItemProvider('scene-script-data', {
  provideCompletionItems(document, position) {
    const completions: vscode.CompletionItem[] = [];

    for (const ins of registry.getAll()) {
      // If no syntax defined, we ignore or use the name
      const label = ins.syntax || ins.name;
      
      const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Function);
      item.detail = `SSD 0x${ins.opcode.toString(16).toUpperCase()}`;
      item.documentation = new vscode.MarkdownString(ins.description);

      if (ins.params && ins.params.length > 0) {
        // Smart snippet: rotateCharacter(${1:characterId}, ${2:unk1})
        const args = ins.params
          .filter(p => !p.optional)
          .map((p, i) => `\${${i + 1}:${p.name}}`)
          .join(', ');
        item.insertText = new vscode.SnippetString(`${label}(${args})`);
      } else {
        item.insertText = `${label}();`;
      }

      completions.push(item);
    }
    return completions;
  }
}, ...'abcdefghijklmnopqrstuvwxyz'.split(''));

/**
 * Called by VS Code when the extension is deactivated.
 */
export function deactivate(): void { }

// #endregion