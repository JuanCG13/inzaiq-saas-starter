/** Pixel size of a WebP file, read from its header. Handles the three container flavors (lossy, lossless, extended). */
export function webpSize(file: Uint8Array): { width: number; height: number } | null {
  const buffer = Buffer.from(file.buffer, file.byteOffset, file.byteLength);
  if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return null;
  switch (buffer.toString('ascii', 12, 16)) {
    case 'VP8 ': // lossy: 14-bit width and height after the 3-byte frame start code
      return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
    case 'VP8L': { // lossless: 14-bit width-1 and height-1 packed after the signature byte
      const bits = buffer.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    case 'VP8X': // extended: 24-bit width-1 and height-1
      return { width: buffer.readUIntLE(24, 3) + 1, height: buffer.readUIntLE(27, 3) + 1 };
    default:
      return null;
  }
}
