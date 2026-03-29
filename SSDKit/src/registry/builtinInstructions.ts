import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { InstructionDef, InstructionCategory } from '../types/instructionDef';
import { InstructionRegistry } from './instructionRegistry';

/**
 * Loads instructions from the external YAML file and flattens them into a list.
 * This function injects the category based on the YAML parent node name.
 */
function loadInstructionsFromYaml(): InstructionDef[] {
    const yamlPath = path.join(__dirname, 'instructions.yml');
    const fileContents = fs.readFileSync(yamlPath, 'utf8');
    
    // Parse YAML into a categorized object: { CategoryName: [Instructions] }
    const data = yaml.load(fileContents) as Record<string, any[]>;
    
    const flattenedList: InstructionDef[] = [];

    for (const [categoryName, instructions] of Object.entries(data)) {
        // Find the matching enum value in InstructionCategory
        const category = InstructionCategory[categoryName as keyof typeof InstructionCategory];

        // Skip the Summary/Comment node if it's not a real category
        if (category === undefined) continue;

        for (const inst of instructions) {
            flattenedList.push({
                ...inst,
                category: category
            });
        }
    }

    return flattenedList;
}

/** 
 * Exported constant containing all built-in instructions.
 * Used by the compiler and decompiler to resolve opcodes.
 */
export const BUILTIN_INSTRUCTIONS: InstructionDef[] = loadInstructionsFromYaml();

/**
 * Factory function to create a registry populated with the above definitions.
 */
export function createDefaultRegistry(): InstructionRegistry {
  const registry = new InstructionRegistry();
  registry.registerAll(BUILTIN_INSTRUCTIONS);
  return registry;
}