import type {
  ProgramNode,
  StatementNode,
  BlockStatementNode,
  SwitchStatementNode,
  SwitchCaseNode,
} from '../types/astNode';

/** Tracks whether we are directly inside a switch case/default body, or inside a loop. */
interface WalkContext {
  inSwitchCase: boolean;
  inLoop: boolean;
}

/**
 * Validates semantic rules not enforced by the grammar/binary layout alone:
 *   - `case`/`default` values are constants, unique within their switch
 *   - a switch has at most one `default`
 *   - `break` only appears inside a case/default body
 *   - each block contains at most one direct `return` (nested blocks each
 *     get their own counter — see §13 of the spec)
 *
 * Throws a descriptive Error on the first violation found.
 */
export function validateProgram(program: ProgramNode): void {
  for (const stmt of program.body) {
    validateStatement(stmt, { inSwitchCase: false, inLoop: false });
  }
}

function validateStatement(stmt: StatementNode, ctx: WalkContext): void {
  switch (stmt.kind) {
    case 'FunctionDeclaration':
      // A function body is a fresh scope: break is never valid at this level.
      validateBlock(stmt.body, { inSwitchCase: false, inLoop: false });
      break;

    case 'IfStatement':
      validateBlock(stmt.consequent, ctx);
      if (stmt.alternate) {
        if (stmt.alternate.kind === 'IfStatement') {
          validateStatement(stmt.alternate, ctx);
        } else {
          validateBlock(stmt.alternate, ctx);
        }
      }
      break;

    case 'WhileStatement':
      // break inside a while loop is now allowed: it targets the loop's own
      // body block. We don't propagate inSwitchCase from the parent context
      // (a break directly in the while body always targets the while, not
      // some unrelated outer switch), we just flag inLoop.
      validateBlock(stmt.body, { inSwitchCase: false, inLoop: true });
      break;

    case 'InitializeChildThreadStatement':
    case 'AddChildThreadStatement':
      validateBlock(stmt.body, { inSwitchCase: false, inLoop: false });
      break;

    case 'SwitchStatement':
      validateSwitchStatement(stmt);
      break;

    case 'BreakStatement':
      if (!ctx.inSwitchCase && !ctx.inLoop) {
        throw new Error('astValidator: "break" is only valid inside a switch case/default block or a while loop.');
      }
      break;

    default:
      // Leaf statements (VariableDeclaration, ExpressionStatement,
      // PrintStatement, ShowMessageBoxStatement, ReturnStatement,
      // UnknownStatement) carry no nested blocks.
      break;
  }
}

function validateBlock(block: BlockStatementNode, ctx: WalkContext): void {
  let returnCount = 0;
  for (const stmt of block.body) {
    if (stmt.kind === 'ReturnStatement') {
      returnCount++;
      if (returnCount > 1) {
        throw new Error('astValidator: a block may contain at most one "return" statement.');
      }
    }
    validateStatement(stmt, ctx);
  }
}

function validateSwitchStatement(node: SwitchStatementNode): void {
  const seenValues = new Set<string>();
  let defaultSeen = false;

  for (const clause of node.cases) {
    if (clause.test === null) {
      if (defaultSeen) {
        throw new Error('astValidator: a switch can only have one "default" clause.');
      }
      defaultSeen = true;
    } else {
      if (clause.test.kind !== 'Literal' && clause.test.kind !== 'StringRef') {
        throw new Error('astValidator: "case" values must be a constant (number or string).');
      }
      const key = clause.test.kind === 'Literal'
        ? `n:${clause.test.value}`
        : `s:${clause.test.display}`;
      if (seenValues.has(key)) {
        throw new Error(`astValidator: duplicate "case" value in switch: ${key.slice(2)}`);
      }
      seenValues.add(key);
    }

    validateSwitchCase(clause);
  }
}

function validateSwitchCase(clause: SwitchCaseNode): void {
  // Each case/default body is its own return-counting scope, and break is
  // valid directly inside it (fall-through statements included).
  validateBlock(clause.consequent, { inSwitchCase: true, inLoop: false });
}