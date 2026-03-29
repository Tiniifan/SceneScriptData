//#region Imports & Description
import * as iconv from 'iconv-lite';

/**
 * Scene Script Encoding (SSE) — the custom single/double-byte encoding used by
 * Level 5 script text files.
 *
 * Single-byte characters are looked up in a static table built from printable
 * ASCII ranges plus a block of extended Latin characters starting at 0xA1.
 * Bytes in the Shift-JIS lead-byte ranges (0x81–0x9F and 0xE0–0xFC) are
 * treated as the start of a two-byte Shift-JIS sequence and decoded
 * accordingly using iconv-lite.
 *
 * All other byte values map to '?' (unknown / control character).
 */
//#endregion

//#region Static decoding table: byte value → Unicode character

const TABLE = new Map<number, string>();

function addRange(chars: string, startByte: number): void {
  for (let i = 0; i < chars.length; i++) {
    TABLE.set(startByte + i, chars[i]);
  }
}

// Digits
addRange('0123456789', 0x30);
// Uppercase letters
addRange('ABCDEFGHIJKLMNOPQRSTUVWXYZ', 0x41);
// Lowercase letters
addRange('abcdefghijklmnopqrstuvwxyz', 0x61);
// Extended Latin block (matches the C# original exactly)
addRange('ÙÚÛÜ¿ÍÏĐÑÒÓÔÕÖØ?àáâãäœæçèéêëìíîïðñòóôõö„ùúûüïý€ÿÀÁÃÄŒÆÇÈÉÊËÌÎÝ¡', 0xA1);

// Individual single-byte mappings
TABLE.set(0x20, ' ');
TABLE.set(0x21, '!');
TABLE.set(0x27, "'");
TABLE.set(0x0A, '\r\n');
TABLE.set(0x2E, '.');
TABLE.set(0x2C, ',');
TABLE.set(0x3F, '?');
TABLE.set(0x5C, '\\');
TABLE.set(0x25, '%');
TABLE.set(0x3A, ':');
TABLE.set(0x5F, '_');

//#endregion

//#region Decoding Logic

/**
 * Returns true when `byte` is a Shift-JIS lead byte (starts a two-byte sequence).
 */
function isShiftJisLead(byte: number): boolean {
  return (byte >= 0x81 && byte <= 0x9F) || (byte >= 0xE0 && byte <= 0xFC);
}

/**
 * Decodes a byte array using Scene Script Encoding (SSE).
 *
 * The input must already be stripped of null terminators by the caller.
 * Unknown byte values are replaced with '?'.
 */
export function sseDecodeBytes(bytes: Buffer | Uint8Array): string {
  const buf    = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const result: string[] = [];
  let   i      = 0;

  while (i < buf.length) {
    const byte = buf[i];

    if (isShiftJisLead(byte)) {
      // Two-byte Shift-JIS sequence
      if (i + 1 < buf.length) {
        const pair = buf.slice(i, i + 2);
        result.push(iconv.decode(pair, 'Shift_JIS'));
        i += 2;
      } else {
        // Truncated sequence at end of buffer
        result.push('?');
        i++;
      }
    } else {
      const ch = TABLE.get(byte);
      result.push(ch ?? '?');
      i++;
    }
  }

  return result.join('');
}

//#endregion

//#region Encoding Logic (inverse of decode)

/** Reverse lookup: first Unicode code unit → byte (single-byte SSE only). */
const REVERSE_TABLE = new Map<number, number>();

for (const [byte, ch] of TABLE) {
  if (ch.length === 1) {
    const code = ch.charCodeAt(0);
    if (!REVERSE_TABLE.has(code)) {
      REVERSE_TABLE.set(code, byte);
    }
  }
}

/**
 * Encodes a JavaScript string into Scene Script Encoding (SSE) bytes.
 * Uses the same single-byte table as {@link sseDecodeBytes} plus Shift-JIS
 * sequences for characters that are not in the table.
 */
export function sseEncodeString(text: string): Buffer {
  const parts: Buffer[] = [];
  let i = 0;

  while (i < text.length) {
    if (text[i] === '\r' && text[i + 1] === '\n') {
      parts.push(Buffer.from([0x0a]));
      i += 2;
      continue;
    }

    const code = text.charCodeAt(i);
    const single = REVERSE_TABLE.get(code);
    if (single !== undefined) {
      parts.push(Buffer.from([single]));
      i++;
      continue;
    }

    const ch = text[i];
    const sjis = iconv.encode(ch, 'Shift_JIS');
    if (sjis.length > 0 && sjis.length <= 2) {
      parts.push(Buffer.from(sjis));
      i++;
      continue;
    }

    parts.push(Buffer.from([0x3f]));
    i++;
  }

  return Buffer.concat(parts);
}

//#endregion