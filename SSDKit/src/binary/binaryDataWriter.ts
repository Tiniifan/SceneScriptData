/**
 * Binary writer for SSD / SST little-endian payloads.
 * Mirrors {@link BinaryDataReader} so round-trips stay predictable.
 */
export class BinaryDataWriter {
  private chunks: Buffer[] = [];
  public bigEndian = false;

  public get length(): number {
    return this.chunks.reduce((sum, c) => sum + c.length, 0);
  }

  public writeValue(value: number, type: string): void {
    let buf: Buffer;

    switch (type.toLowerCase()) {
      case 'byte':
      case 'uint8':
        buf = Buffer.alloc(1);
        buf.writeUInt8(value & 0xff, 0);
        break;
      case 'int8':
        buf = Buffer.alloc(1);
        buf.writeInt8(value, 0);
        break;
      case 'int16':
        buf = Buffer.alloc(2);
        if (this.bigEndian) buf.writeInt16BE(value, 0);
        else buf.writeInt16LE(value, 0);
        break;
      case 'uint16':
        buf = Buffer.alloc(2);
        if (this.bigEndian) buf.writeUInt16BE(value, 0);
        else buf.writeUInt16LE(value, 0);
        break;
      case 'int32':
        buf = Buffer.alloc(4);
        if (this.bigEndian) buf.writeInt32BE(value, 0);
        else buf.writeInt32LE(value, 0);
        break;
      case 'uint32':
        buf = Buffer.alloc(4);
        if (this.bigEndian) buf.writeUInt32BE(value, 0);
        else buf.writeUInt32LE(value, 0);
        break;
      default:
        throw new Error(`BinaryDataWriter: unsupported type "${type}"`);
    }

    this.chunks.push(buf);
  }

  public writeBytes(data: Buffer | Uint8Array): void {
    this.chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
  }

  public writeFixedString(str: string, length: number, encoding: BufferEncoding = 'ascii'): void {
    const buf = Buffer.alloc(length, 0);
    buf.write(str, 0, length, encoding);
    this.chunks.push(buf);
  }

  public toBuffer(): Buffer {
    return Buffer.concat(this.chunks);
  }
}
