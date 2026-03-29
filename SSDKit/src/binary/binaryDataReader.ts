import { getPrimitiveTypeFromArray, isPrimitiveArrayTypeString } from './primitiveTypes';

/**
 * Represents a binary data reader with support for big-endian and little-endian formats.
 */
export class BinaryDataReader {
  private buffer: Buffer;
  private position: number = 0;

  public bigEndian: boolean = false;

  public get length(): number {
    return this.buffer.length;
  }

  public get pos(): number {
    return this.position;
  }

  constructor(data: Buffer | Uint8Array) {
    this.buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  }

  public readValue<T>(type: string): T {
    let value: unknown;

    switch (type.toLowerCase()) {
      case 'byte':
      case 'uint8':
        value = this.buffer.readUInt8(this.position);
        this.position += 1;
        break;
      case 'int8':
        value = this.buffer.readInt8(this.position);
        this.position += 1;
        break;
      case 'int16':
        value = this.bigEndian
          ? this.buffer.readInt16BE(this.position)
          : this.buffer.readInt16LE(this.position);
        this.position += 2;
        break;
      case 'uint16':
        value = this.bigEndian
          ? this.buffer.readUInt16BE(this.position)
          : this.buffer.readUInt16LE(this.position);
        this.position += 2;
        break;
      case 'int32':
        value = this.bigEndian
          ? this.buffer.readInt32BE(this.position)
          : this.buffer.readInt32LE(this.position);
        this.position += 4;
        break;
      case 'uint32':
        value = this.bigEndian
          ? this.buffer.readUInt32BE(this.position)
          : this.buffer.readUInt32LE(this.position);
        this.position += 4;
        break;
      case 'float':
        value = this.bigEndian
          ? this.buffer.readFloatBE(this.position)
          : this.buffer.readFloatLE(this.position);
        this.position += 4;
        break;
      case 'double':
        value = this.bigEndian
          ? this.buffer.readDoubleBE(this.position)
          : this.buffer.readDoubleLE(this.position);
        this.position += 8;
        break;
      default:
        throw new Error(`Unsupported type: ${type}`);
    }

    return value as T;
  }

  public readInterface<T>(obj: T): void {
    for (const key in obj) {
      const field = obj[key];
      if (field && typeof field === 'object' && 'type' in field && 'value' in field) {
        const typedField = field as { type: string; value: unknown; size?: string; length?: number };

        if (typedField.type === 'boolean' && 'size' in typedField) {
          const numValue = this.readValue<number>(typedField.size as string);
          typedField.value = numValue !== 0;
        } else if (typedField.type.endsWith('[]') && 'length' in typedField) {
          const length = typedField.length as number;
          if (isPrimitiveArrayTypeString(typedField.type)) {
            const primitiveType = getPrimitiveTypeFromArray(typedField.type)!;
            typedField.value = this.readMultipleValue(primitiveType, length);
          } else {
            for (let i = 0; i < (typedField.value as unknown[]).length; i++) {
              this.readInterface((typedField.value as unknown[])[i]);
            }
          }
        } else if (!typedField.type.endsWith('[]')) {
          typedField.value = this.readValue(typedField.type);
        }
      }
    }
  }

  public readMultipleInterface<T>(count: number, creator: (new () => T) | (() => T)): T[] {
    const objects: T[] = [];
    for (let i = 0; i < count; i++) {
      const obj =
        typeof creator === 'function' && creator.prototype
          ? new (creator as new () => T)()
          : (creator as () => T)();
      this.readInterface(obj);
      objects.push(obj);
    }
    return objects;
  }

  public readInt24(): number {
    const bytes = this.buffer.slice(this.position, this.position + 3);
    this.position += 3;
    return this.bigEndian
      ? (bytes[0] << 16) | (bytes[1] << 8) | bytes[2]
      : bytes[0] | (bytes[1] << 8) | (bytes[2] << 16);
  }

  public readInt32(): number {
    const value = this.bigEndian
      ? this.buffer.readInt32BE(this.position)
      : this.buffer.readInt32LE(this.position);
    this.position += 4;
    return value;
  }

  public readMultipleValue<T>(type: string, count: number): T[] {
    const result: T[] = [];
    for (let i = 0; i < count; i++) {
      result.push(this.readValue<T>(type));
    }
    return result;
  }

  /**
   * Reads a null-terminated string from the buffer.
   */
  public readString(encoding: BufferEncoding = 'utf8'): string {
    const bytes: number[] = [];
    while (this.position < this.buffer.length) {
      const byte = this.buffer.readUInt8(this.position);
      this.position++;
      if (byte === 0x00) break;
      bytes.push(byte);
    }
    return Buffer.from(bytes).toString(encoding);
  }

  /**
   * Reads a fixed-length string from the buffer (no null terminator expected).
   */
  public readFixedString(length: number, encoding: BufferEncoding = 'ascii'): string {
    const data = this.buffer.slice(this.position, this.position + length);
    this.position += length;
    return data.toString(encoding);
  }

  public skip(size: number): void {
    this.position += size;
  }

  public seek(position: number): void {
    this.position = position;
  }

  public getSection(size: number): Buffer {
    const data = this.buffer.slice(this.position, this.position + size);
    this.position += size;
    return data;
  }

  public getSectionAt(offset: number, size: number): Buffer {
    const temp = this.position;
    this.seek(offset);
    const data = this.buffer.slice(this.position, this.position + size);
    this.seek(temp);
    return data;
  }

  public find<T>(type: string, search: T, start: number): number {
    const temp = this.position;
    this.seek(start);
    while (this.position < this.buffer.length) {
      const value = this.readValue<T>(type);
      if (value === search) {
        const foundPos = this.position - this.getTypeSize(type);
        this.seek(temp);
        return foundPos;
      }
    }
    this.seek(temp);
    return -1;
  }

  public seekOf<T>(type: string, search: T, start: number): void {
    const pos = this.find(type, search, start);
    if (pos !== -1) {
      this.seek(pos);
    } else {
      throw new Error('Value not found in buffer');
    }
  }

  public printPosition(): void {
    console.log(this.position.toString(16).toUpperCase());
  }

  private getTypeSize(type: string): number {
    switch (type.toLowerCase()) {
      case 'byte':
      case 'int8':
      case 'uint8':
        return 1;
      case 'int16':
      case 'uint16':
        return 2;
      case 'int32':
      case 'uint32':
      case 'float':
        return 4;
      case 'double':
        return 8;
      default:
        throw new Error(`Unsupported type: ${type}`);
    }
  }
}