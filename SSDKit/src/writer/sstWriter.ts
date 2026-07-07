import { BinaryDataWriter } from '../binary/binaryDataWriter';
import { sseEncodeString } from '../reader/sseEncoding';

/**
 * One SST row to emit (matches {@link SSTReader} entry layout).
 */
export interface SSTWriteEntry {
  /** Same key as the SSD instruction id that owns the ArgType.String argument. */
  instructionId: number;
  argIndex: number;
  unk2: number;
  /** Plain text; encoded with SSE before writing. */
  text: string;
}

/**
 * Serialises SST rows into the binary format consumed by {@link SSTReader}.
 */
export function writeSSTBuffer(entries: SSTWriteEntry[]): Buffer {
  const body = new BinaryDataWriter();
  body.bigEndian = false;

  for (const e of entries) {
    const rawText = sseEncodeString(e.text);

    // Always append two null terminator, independently of alignment.
    const withTerminator = Buffer.concat([rawText, Buffer.alloc(2, 0)]);

    // Pad further if needed so the entry ends on a 4-byte boundary.
    const lengthWithTerminator = 8 + withTerminator.length;
    const padding = (4 - (lengthWithTerminator % 4)) % 4;
    const paddedText = padding > 0
      ? Buffer.concat([withTerminator, Buffer.alloc(padding, 0)])
      : withTerminator;

    const textByteCount = paddedText.length;
    const length = 8 + textByteCount;

    body.writeValue(e.instructionId & 0xffff, 'int16');
    body.writeValue(e.argIndex & 0xffff, 'int16');
    body.writeValue(length & 0xffff, 'int16');
    body.writeValue(e.unk2 & 0xffff, 'int16');
    body.writeBytes(paddedText);
  }

  const payload = body.toBuffer();
  const out = new BinaryDataWriter();
  out.bigEndian = false;
  out.writeValue(payload.length, 'int32');
  out.writeBytes(payload);
  return out.toBuffer();
}
