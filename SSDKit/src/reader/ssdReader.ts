import { BinaryDataReader }                    from '../binary/binaryDataReader';
import { parseArgTypes }                        from '../types/argType';
import { SSDFile, SSDHeader, RawInstruction }   from '../types/rawInstruction';

/**
 * Reads an SSD binary file and returns the structured raw data.
 * No semantic analysis is performed here — this is purely a binary parser.
 */
export class SSDReader {
  private reader: BinaryDataReader;

  constructor(buffer: Buffer) {
    this.reader = new BinaryDataReader(buffer);
    // SSD files are little-endian
    this.reader.bigEndian = false;
  }

  /**
   * Parses the full SSD file and returns header + raw instruction list.
   */
  public read(): SSDFile {
    const header       = this.readHeader();
    const instructions = this.readInstructions(header.instCount);
    return { header, instructions };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private readHeader(): SSDHeader {
    return {
      magic:     this.reader.readFixedString(4, 'ascii'),
      version:   this.reader.readValue<number>('uint32'),
      size:      this.reader.readValue<number>('uint32'),
      instCount: this.reader.readValue<number>('int16'),
      textCount: this.reader.readValue<number>('int16'),
      instSize:  this.reader.readValue<number>('uint32'),
      textSize:  this.reader.readValue<number>('uint32'),
      pad0:      this.reader.readValue<number>('uint32'),
      pad1:      this.reader.readValue<number>('uint32'),
    };
  }

  private readInstructions(count: number): RawInstruction[] {
    const instructions: RawInstruction[] = [];

    for (let index = 0; index < count; index++) {
      const id        = this.reader.readValue<number>('int16');
      const size      = this.reader.readValue<number>('int16');
      const type      = this.reader.readValue<number>('uint16');
      const argsCount = this.reader.readValue<number>('uint8');
      const unk       = this.reader.readValue<number>('uint8');

      // Argument type descriptors: 2 types per byte, packed as nibbles.
      // The number of packed bytes is always ceil(argsCount / 8) * 4.
      const argTypesByteCount = 4 * Math.ceil(argsCount / 8);
      const argTypesRaw: number[] = [];
      for (let b = 0; b < argTypesByteCount; b++) {
        argTypesRaw.push(this.reader.readValue<number>('uint8'));
      }

      const argTypes = parseArgTypes(argTypesRaw, argsCount);

      // Argument values: one uint32 per argument
      const args: number[] = [];
      for (let a = 0; a < argsCount; a++) {
        args.push(this.reader.readValue<number>('uint32'));
      }

      instructions.push({ index, id, size, type, argsCount, unk, argTypesRaw, argTypes, args });
    }

    return instructions;
  }
}