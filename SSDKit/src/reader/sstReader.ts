//#region Imports
import { BinaryDataReader } from '../binary/binaryDataReader';
import { sseDecodeBytes } from './sseEncoding';
//#endregion

//#region Types

/**
 * A single text entry from an SST (Scene Script Text) file.
 */
export interface SSTEntry {
    /** Text identifier — used by SSD instructions to reference this string. */
    instructionId: number;
    unk1: number;
    unk2: number;
    /** Decoded text using Scene Script Encoding (SSE). */
    text: string;
}

//#endregion

//#region SSTFile — parsed container with fast lookup

/**
 * Parsed SST file.  Provides O(1) lookup by SSD instruction id (same key as `RawInstruction.id`).
 */
export class SSTFile {
    public readonly entries: SSTEntry[];
    private readonly byInstructionId: Map<number, SSTEntry>;

    constructor(entries: SSTEntry[]) {
        this.entries = entries;
        this.byInstructionId = new Map(entries.map((e) => [e.instructionId, e]));
    }

    /**
     * Returns the entry with the given ID, or undefined if not found.
     */
    public getById(id: number): SSTEntry | undefined {
        return this.byInstructionId.get(id);
    }

    /**
     * Returns the decoded text for the SST row whose key equals the SSD instruction id.
     */
    public getText(id: number): string | undefined {
        return this.byInstructionId.get(id)?.text;
    }
}

//#endregion

//#region SSTReader

/**
 * Reads an SST (Scene Script Text) binary file.
 *
 * File layout:
 *   [4 bytes] int32   totalLength  — total byte length of the file (including this field)
 *   [N entries] until position reaches totalLength:
 *     [2 bytes] int16  instructionId  — same value as the matching SSD `RawInstruction.id`
 *     [2 bytes] int16  unk1
 *     [2 bytes] int16  length       — total size of this entry in bytes (header + text)
 *     [2 bytes] int16  unk2
 *     [length - 8 bytes] raw text   — null-padded, decoded using SSE
 */
export class SSTReader {
    private readonly reader: BinaryDataReader;

    constructor(buffer: Buffer) {
        this.reader = new BinaryDataReader(buffer);
        // SST files are little-endian
        this.reader.bigEndian = false;
    }

    public read(): SSTFile {
        const totalLength = this.reader.readValue<number>('int32');
        const entries: SSTEntry[] = [];

        while (this.reader.pos < totalLength) {
            const instructionId = this.reader.readValue<number>('int16');
            const unk1 = this.reader.readValue<number>('int16');
            const length = this.reader.readValue<number>('int16'); // includes 8-byte entry header
            const unk2 = this.reader.readValue<number>('int16');

            // Text occupies (length - 8) bytes; strip trailing null bytes before decoding
            const textByteCount = Math.max(0, length - 8);
            const rawBytes = this.reader.getSection(textByteCount);

            let end = rawBytes.length;
            while (end > 0 && rawBytes[end - 1] === 0x00) end--;

            const text = sseDecodeBytes(rawBytes.slice(0, end));
            entries.push({ instructionId, unk1, unk2, text });
        }

        return new SSTFile(entries);
    }
}

//#endregion