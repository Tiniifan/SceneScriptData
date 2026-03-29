import * as fs   from 'fs';
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

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const FONT_FAMILY     = 'monospace';
const FONT_SIZE       = 12;
const LINE_HEIGHT     = FONT_SIZE + 4;
const H_PADDING       = 12;
const V_PADDING       = 8;
const INDENT_WIDTH    = 24;
const NODE_GAP        = 8;
const MIN_NODE_WIDTH  = 200;

// Category colour palette (background, border, text)
const COLORS: Record<string, { bg: string; border: string; text: string }> = {
  Program:             { bg: '#1e1e2e', border: '#cba6f7', text: '#cdd6f4' },
  FunctionDeclaration: { bg: '#1e3a5f', border: '#89b4fa', text: '#cdd6f4' },
  IfStatement:         { bg: '#3b2f1e', border: '#fab387', text: '#cdd6f4' },
  WhileStatement:      { bg: '#2a3b1e', border: '#a6e3a1', text: '#cdd6f4' },
  BlockStatement:      { bg: '#252535', border: '#585b70', text: '#cdd6f4' },
  VariableDeclaration: { bg: '#1e3a2f', border: '#94e2d5', text: '#cdd6f4' },
  ExpressionStatement: { bg: '#2a2a3e', border: '#b4befe', text: '#cdd6f4' },
  PrintStatement: { bg: '#1e2f3a', border: '#74c7ec', text: '#cdd6f4' },
  ShowMessageBoxStatement: { bg: '#1e2f3a', border: '#74c7ec', text: '#cdd6f4' },
  InitializeChildThreadStatement: { bg: '#2a1e3a', border: '#cba6f7', text: '#cdd6f4' },
  AddChildThreadStatement: { bg: '#1e2a3a', border: '#89dceb', text: '#cdd6f4' },
  UnknownStatement:    { bg: '#3a1e1e', border: '#f38ba8', text: '#cdd6f4' },
  default:             { bg: '#252535', border: '#6c7086', text: '#cdd6f4' },
};

// ---------------------------------------------------------------------------
// Rendered box
// ---------------------------------------------------------------------------

interface Box {
  x:      number;
  y:      number;
  width:  number;
  height: number;
  svg:    string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ImageExportOptions {
  /** Only export the function with this name */
  functionName?: string;
  /** Canvas left/right margin (default: 32) */
  margin?: number;
}

/**
 * Renders a ProgramNode (or a single function) as an SVG string.
 */
export function exportToSVG(program: ProgramNode, options: ImageExportOptions = {}): string {
  const margin  = options.margin ?? 32;
  const context = new LayoutContext(margin);

  let rootBox: Box;
  if (options.functionName) {
    const fn = findFunction(program, options.functionName);
    if (!fn) throw new Error(`Function "${options.functionName}" not found.`);
    rootBox = context.renderFunction(fn, margin, margin);
  } else {
    rootBox = context.renderProgram(program, margin, margin);
  }

  const totalW = rootBox.x + rootBox.width  + margin;
  const totalH = rootBox.y + rootBox.height + margin;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">`,
    `<rect width="${totalW}" height="${totalH}" fill="#1e1e2e"/>`,
    rootBox.svg,
    '</svg>',
  ].join('\n');
}

/**
 * Writes the SVG to a file and returns the output path.
 */
export function exportToSVGFile(
  program:    ProgramNode,
  outputPath: string,
  options:    ImageExportOptions = {}
): string {
  const svg = exportToSVG(program, options);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, svg, 'utf8');
  return outputPath;
}

// ---------------------------------------------------------------------------
// Layout engine
// ---------------------------------------------------------------------------

class LayoutContext {
  private readonly margin: number;

  constructor(margin: number) {
    this.margin = margin;
  }

  // -----------
  // Program
  // -----------

  renderProgram(program: ProgramNode, x: number, y: number): Box {
    const label  = `SSD Program  (version ${program.version})`;
    const colors = COLORS['Program'];

    let curY      = y + V_PADDING * 2 + LINE_HEIGHT;
    let maxWidth  = MIN_NODE_WIDTH;
    const parts: string[] = [];

    for (const stmt of program.body) {
      const box = this.renderStatement(stmt, x + H_PADDING, curY);
      parts.push(box.svg);
      maxWidth = Math.max(maxWidth, box.width + H_PADDING * 2);
      curY     = box.y + box.height + NODE_GAP;
    }

    const width  = maxWidth;
    const height = curY - y + V_PADDING;

    const header = this.makeRect(x, y, width, LINE_HEIGHT + V_PADDING * 2, colors, label, true);
    return { x, y, width, height, svg: [header, ...parts].join('\n') };
  }

  // -----------
  // Function
  // -----------

  renderFunction(fn: FunctionDeclarationNode, x: number, y: number): Box {
    const params  = fn.params.map((p) => p.name).join(', ');
    const line1   = `function  ${fn.name}(${params})`;
    const colors  = COLORS['FunctionDeclaration'];

    const headerH = LINE_HEIGHT + V_PADDING * 2;
    const wLine1  = Math.max(MIN_NODE_WIDTH, estimateTextWidth(line1) + H_PADDING * 2);
    const reqLine = fn.condition ? `requires (${exprToString(fn.condition)})` : null;
    const wReq    = reqLine
      ? Math.max(MIN_NODE_WIDTH, estimateTextWidth(reqLine) + H_PADDING * 2)
      : 0;
    const headerW = Math.max(wLine1, wReq);

    const parts: string[] = [];
    let curY = y;

    parts.push(this.makeRect(x, curY, headerW, headerH, colors, line1, true));
    curY += headerH + NODE_GAP;

    if (reqLine) {
      parts.push(this.makeRect(x, curY, headerW, headerH, colors, reqLine, false));
      curY += headerH + NODE_GAP;
    }

    const bodyBox = this.renderBlock(fn.body, x + INDENT_WIDTH, curY);

    const width  = Math.max(headerW, bodyBox.width + INDENT_WIDTH + H_PADDING);
    const height = bodyBox.y + bodyBox.height - y;

    return { x, y, width, height, svg: [...parts, bodyBox.svg].join('\n') };
  }

  // -----------
  // Block { }
  // -----------

  renderBlock(block: BlockStatementNode, x: number, y: number): Box {
    const colors  = COLORS['BlockStatement'];
    const bracketH = LINE_HEIGHT + V_PADDING;

    const openLabel  = '{';
    const closeLabel = '}';

    let curY     = y + bracketH + NODE_GAP / 2;
    let maxWidth = MIN_NODE_WIDTH;
    const parts: string[] = [];

    for (const stmt of block.body) {
      const box = this.renderStatement(stmt, x + INDENT_WIDTH, curY);
      parts.push(box.svg);
      maxWidth = Math.max(maxWidth, box.width + INDENT_WIDTH);
      curY     = box.y + box.height + NODE_GAP;
    }

    const totalWidth  = maxWidth + H_PADDING;
    const closeY      = curY;
    const totalHeight = closeY + bracketH - y;

    const openSvg  = this.makeRect(x, y,       totalWidth, bracketH, colors, openLabel,  false);
    const closeSvg = this.makeRect(x, closeY,  totalWidth, bracketH, colors, closeLabel, false);

    return {
      x, y,
      width:  totalWidth,
      height: totalHeight,
      svg:    [openSvg, ...parts, closeSvg].join('\n'),
    };
  }

  // -----------
  // Statements
  // -----------

  renderStatement(stmt: StatementNode, x: number, y: number): Box {
    switch (stmt.kind) {
      case 'FunctionDeclaration':  return this.renderFunction(stmt, x, y);
      case 'IfStatement':          return this.renderIfStatement(stmt, x, y);
      case 'WhileStatement':       return this.renderWhileStatement(stmt, x, y);
      case 'VariableDeclaration':  return this.renderLeaf(stmt.kind, `local ${stmt.name} = ${exprToString(stmt.init)}`, x, y);
      case 'ExpressionStatement':  return this.renderLeaf(stmt.kind, exprToString(stmt.expression), x, y);
      case 'PrintStatement': {
        const allArgs = [stmt.format, ...stmt.args].map(exprToString).join(', ');
        return this.renderLeaf(stmt.kind, `print(${allArgs})`, x, y);
      }
      case 'ShowMessageBoxStatement': {
        const allArgs = [stmt.format, ...stmt.args].map(exprToString).join(', ');
        return this.renderLeaf(stmt.kind, `showMessageBox(${allArgs})`, x, y);
      }
      case 'InitializeChildThreadStatement':
        return this.renderThreadScope(stmt.kind, 'initializeChildThread', stmt.unk1, stmt.body, x, y);
      case 'AddChildThreadStatement':
        return this.renderThreadScope(stmt.kind, 'addChildThread', stmt.unk1, stmt.body, x, y);
      case 'UnknownStatement':     return this.renderLeaf(stmt.kind, `${stmt.opcodeHex}(${stmt.args.join(', ')})`, x, y);
    }
  }

  renderThreadScope(
    kind: string,
    keyword: string,
    unk: ExpressionNode,
    body: BlockStatementNode,
    x: number,
    y: number
  ): Box {
    const colors  = COLORS[kind] ?? COLORS['default'];
    const label   = `${keyword} (${exprToString(unk)})`;
    const headerH = LINE_HEIGHT + V_PADDING * 2;
    const bodyBox = this.renderBlock(body, x + INDENT_WIDTH, y + headerH + NODE_GAP);
    const width   = Math.max(MIN_NODE_WIDTH, bodyBox.width + INDENT_WIDTH);
    const height  = headerH + NODE_GAP + bodyBox.height;
    const header  = this.makeRect(x, y, width, headerH, colors, label, true);
    return { x, y, width, height, svg: [header, bodyBox.svg].join('\n') };
  }

  renderIfStatement(node: IfStatementNode, x: number, y: number): Box {
    const colors  = COLORS['IfStatement'];
    const condStr = exprToString(node.condition);
    const label   = `if (${condStr})`;
    const headerH = LINE_HEIGHT + V_PADDING * 2;

    const consBox  = this.renderBlock(node.consequent, x + INDENT_WIDTH, y + headerH + NODE_GAP);
    let totalH     = headerH + NODE_GAP + consBox.height;
    let maxW       = Math.max(MIN_NODE_WIDTH, consBox.width + INDENT_WIDTH);

    const parts    = [this.makeRect(x, y, maxW, headerH, colors, label, true), consBox.svg];

    if (node.alternate) {
      const elseY    = y + totalH + NODE_GAP;
      const altIsIf  = node.alternate.kind === 'IfStatement';
      const elseLabel = this.makeRect(x, elseY, maxW, headerH, COLORS['IfStatement'],
                                      altIsIf ? 'else' : 'else', true);
      let altBox: Box;
      if (altIsIf) {
        altBox = this.renderIfStatement(node.alternate as IfStatementNode, x + INDENT_WIDTH, elseY + headerH + NODE_GAP);
      } else {
        altBox = this.renderBlock(node.alternate as BlockStatementNode, x + INDENT_WIDTH, elseY + headerH + NODE_GAP);
      }
      maxW    = Math.max(maxW, altBox.width + INDENT_WIDTH);
      totalH += NODE_GAP + headerH + NODE_GAP + altBox.height;
      parts.push(elseLabel, altBox.svg);
    }

    return { x, y, width: maxW, height: totalH, svg: parts.join('\n') };
  }

  renderWhileStatement(node: WhileStatementNode, x: number, y: number): Box {
    const colors  = COLORS['WhileStatement'];
    const label   = `while (${exprToString(node.condition)})`;
    const headerH = LINE_HEIGHT + V_PADDING * 2;
    const bodyBox = this.renderBlock(node.body, x + INDENT_WIDTH, y + headerH + NODE_GAP);
    const width   = Math.max(MIN_NODE_WIDTH, bodyBox.width + INDENT_WIDTH);
    const height  = headerH + NODE_GAP + bodyBox.height;
    const header  = this.makeRect(x, y, width, headerH, colors, label, true);
    return { x, y, width, height, svg: [header, bodyBox.svg].join('\n') };
  }

  renderLeaf(kind: string, text: string, x: number, y: number): Box {
    const colors  = COLORS[kind] ?? COLORS['default'];
    const height  = LINE_HEIGHT + V_PADDING * 2;
    const width   = Math.max(MIN_NODE_WIDTH, estimateTextWidth(text) + H_PADDING * 2);
    const svg     = this.makeRect(x, y, width, height, colors, text, false);
    return { x, y, width, height, svg };
  }

  // -----------
  // SVG primitives
  // -----------

  private makeRect(
    x:      number,
    y:      number,
    width:  number,
    height: number,
    colors: { bg: string; border: string; text: string },
    label:  string,
    bold:   boolean
  ): string {
    const rx  = 4;
    const tx  = x + H_PADDING;
    const ty  = y + height / 2;
    const fw  = bold ? 'bold' : 'normal';

    return [
      `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" ry="${rx}" fill="${colors.bg}" stroke="${colors.border}" stroke-width="1.5"/>`,
      `<text x="${tx}" y="${ty}" font-family="${FONT_FAMILY}" font-size="${FONT_SIZE}" font-weight="${fw}" fill="${colors.text}" dominant-baseline="middle">${escapeXML(truncate(label, 80))}</text>`,
    ].join('\n');
  }
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

function estimateTextWidth(text: string): number {
  // Monospace approximation: ~7.2 px per character at 12px
  return text.length * 7.2;
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 3) + '...' : text;
}

function escapeXML(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}