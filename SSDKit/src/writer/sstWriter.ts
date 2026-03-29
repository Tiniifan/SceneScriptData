import { BinaryDataWriter } from '../binary/binaryDataWriter';
import { sseEncodeString } from '../reader/sseEncoding';

/**
 * One SST row to emit (matches {@link SSTReader} entry layout).
 */
export interface SSTWriteEntry {
  /** Same key as the SSD instruction id that owns the ArgType.String argument. */
  instructionId: number;
  unk1: number;
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
    const textByteCount = rawText.length;
    const length = 8 + textByteCount;

    body.writeValue(e.instructionId & 0xffff, 'int16');
    body.writeValue(e.unk1 & 0xffff, 'int16');
    body.writeValue(length & 0xffff, 'int16');
    body.writeValue(e.unk2 & 0xffff, 'int16');
    body.writeBytes(rawText);
  }

  const payload = body.toBuffer();
  const out = new BinaryDataWriter();
  out.bigEndian = false;
  const totalLength = 4 + payload.length;
  out.writeValue(totalLength, 'int32');
  out.writeBytes(payload);
  return out.toBuffer();
}
