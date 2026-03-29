import { BinaryDataWriter } from '../binary/binaryDataWriter';
import { packArgTypes, argTypeName } from '../types/argType';
import { ArgType } from '../types/argType';
import { RawInstruction, SSDFile, SSDHeader } from '../types/rawInstruction';

const HEADER_BYTE_LENGTH = 32;

/**
 * Computes the int16 `size` field stored on each instruction row.
 * Matches the payload length that follows the `id` and `size` fields in {@link SSDReader}.
 */
export function computeInstructionPayloadSize(inst: Pick<RawInstruction, 'argsCount' | 'argTypesRaw' | 'args'>): number {
  return 2 + 1 + 1 + inst.argTypesRaw.length + inst.args.length * 4;
}

/**
 * Computes the on-disk byte length of one full instruction record (id through args).
 */
export function computeInstructionRecordSize(inst: Pick<RawInstruction, 'argsCount' | 'argTypesRaw' | 'args'>): number {
  return 2 + 2 + computeInstructionPayloadSize(inst);
}

/**
 * Builds a raw {@link RawInstruction} with packed type bytes and a consistent `size` field.
 */
export function makeRawInstruction(
  index: number,
  id: number,
  type: number,
  unk: number,
  argDescriptors: { type: ArgType; value: number }[]
): RawInstruction {
  const types = argDescriptors.map((a) => a.type);
  const args = argDescriptors.map((a) => a.value >>> 0);
  const argsCount = args.length;
  const argTypesRaw = packArgTypes(types);
  const argTypes = argDescriptors.map((a, i) => ({
    raw: types[i] & 0x0f,
    type: types[i],
    name: argTypeName(types[i]),
  }));

  const payloadSize = computeInstructionPayloadSize({
    argsCount,
    argTypesRaw,
    args,
  });

  return {
    index,
    id,
    size: payloadSize,
    type,
    argsCount,
    unk,
    argTypesRaw,
    argTypes,
    args,
  };
}

/**
 * Serialises {@link SSDFile} to a Buffer (little-endian), same layout {@link SSDReader} expects.
 */
export function writeSSDBuffer(file: SSDFile): Buffer {
  const w = new BinaryDataWriter();
  w.bigEndian = false;

  const h = file.header;
  w.writeFixedString(h.magic.length >= 4 ? h.magic.slice(0, 4) : h.magic.padEnd(4, '\0'), 4, 'ascii');
  w.writeValue(h.version >>> 0, 'uint32');
  w.writeValue(h.size >>> 0, 'uint32');
  w.writeValue(h.instCount & 0xffff, 'int16');
  w.writeValue(h.textCount & 0xffff, 'int16');
  w.writeValue(h.instSize >>> 0, 'uint32');
  w.writeValue(h.textSize >>> 0, 'uint32');
  w.writeValue(h.pad0 >>> 0, 'uint32');
  w.writeValue(h.pad1 >>> 0, 'uint32');

  for (const inst of file.instructions) {
    w.writeValue(inst.id & 0xffff, 'int16');
    w.writeValue(inst.size & 0xffff, 'int16');
    w.writeValue(inst.type & 0xffff, 'uint16');
    w.writeValue(inst.argsCount & 0xff, 'uint8');
    w.writeValue(inst.unk & 0xff, 'uint8');
    for (const b of inst.argTypesRaw) {
      w.writeValue(b & 0xff, 'uint8');
    }
    for (const a of inst.args) {
      w.writeValue(a >>> 0, 'uint32');
    }
  }

  return w.toBuffer();
}

/**
 * Fills header size fields from the instruction block and optional text block sizes.
 */
export function buildSSDHeader(
  instCount: number,
  instBodyByteLength: number,
  version: number,
  opts?: { magic?: string; textCount?: number; textSize?: number; pad0?: number; pad1?: number }
): SSDHeader {
  const magic = opts?.magic ?? 'SSD\0';
  const textCount = opts?.textCount ?? 0;
  const textSize = opts?.textSize ?? 0;
  const pad0 = opts?.pad0 ?? 0;
  const pad1 = opts?.pad1 ?? 0;
  const size = HEADER_BYTE_LENGTH + instBodyByteLength + textSize;

  return {
    magic,
    version,
    size,
    instCount,
    textCount,
    instSize: instBodyByteLength,
    textSize,
    pad0,
    pad1,
  };
}
