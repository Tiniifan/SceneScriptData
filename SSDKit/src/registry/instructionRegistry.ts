import { InstructionDef } from '../types/instructionDef';

/**
 * Central registry of all known SSD instruction types.
 *
 * Usage:
 *   const registry = new InstructionRegistry();
 *   registry.register(myDef);
 *   const def = registry.get(0x6001);
 *
 * The registry is intentionally separate from the AST builder so that
 * new opcodes can be added without touching any builder logic.
 * The VS Code extension will query this registry for hover information.
 */
export class InstructionRegistry {
  private readonly map = new Map<number, InstructionDef>();

  /**
   * Registers a single instruction definition.
   * Throws if the opcode is already registered (prevents silent overwrites).
   */
  public register(def: InstructionDef): void {
    if (this.map.has(def.opcode)) {
      throw new Error(
        `Opcode 0x${def.opcode.toString(16).toUpperCase()} is already registered as "${this.map.get(def.opcode)!.name}".`
      );
    }
    this.map.set(def.opcode, def);
  }

  /**
   * Registers multiple instruction definitions at once.
   */
  public registerAll(defs: InstructionDef[]): void {
    for (const def of defs) this.register(def);
  }

  /**
   * Returns the definition for a given opcode, or undefined if unknown.
   */
  public get(opcode: number): InstructionDef | undefined {
    return this.map.get(opcode);
  }

  /**
   * Returns true if the opcode has a registered definition.
   */
  public has(opcode: number): boolean {
    return this.map.has(opcode);
  }

  /**
   * Returns all registered definitions, sorted by opcode.
   */
  public getAll(): InstructionDef[] {
    return [...this.map.values()].sort((a, b) => a.opcode - b.opcode);
  }

  /**
   * Returns a plain-object snapshot of the full registry.
   * Useful for serialising the catalog to JSON for the VS Code extension.
   */
  public toJSON(): Record<string, InstructionDef> {
    const out: Record<string, InstructionDef> = {};
    for (const [opcode, def] of this.map) {
      out[`0x${opcode.toString(16).toUpperCase().padStart(4, '0')}`] = def;
    }
    return out;
  }
}