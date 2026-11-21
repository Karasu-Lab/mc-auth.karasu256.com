export function readVarInt(buffer: Buffer, offset: number): { value: number; size: number } | null {
  let value = 0;
  let size = 0;
  for (;;) {
    if (offset + size >= buffer.length) return null;
    const byte = buffer[offset + size];
    value |= (byte & 0x7f) << (7 * size);
    size++;
    if ((byte & 0x80) === 0) return { value, size };
    if (size >= 5) throw new Error('VarInt is too long');
  }
}

export function writeVarInt(value: number): Buffer {
  const bytes: number[] = [];
  let remaining = value >>> 0;
  do {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (remaining !== 0);
  return Buffer.from(bytes);
}

export function writeString(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  return Buffer.concat([writeVarInt(bytes.length), bytes]);
}

export function writeBytes(value: Buffer): Buffer {
  return Buffer.concat([writeVarInt(value.length), value]);
}

export function encodePacket(id: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat([writeVarInt(id), ...parts]);
  return Buffer.concat([writeVarInt(body.length), body]);
}

export class PacketReader {
  private position = 0;

  constructor(private readonly buffer: Buffer) {}

  varInt(): number {
    const result = readVarInt(this.buffer, this.position);
    if (!result) throw new Error('Truncated VarInt');
    this.position += result.size;
    return result.value;
  }

  bytes(length: number): Buffer {
    if (this.position + length > this.buffer.length) throw new Error('Truncated packet');
    const value = this.buffer.subarray(this.position, this.position + length);
    this.position += length;
    return value;
  }

  string(): string {
    return this.bytes(this.varInt()).toString('utf8');
  }

  unsignedShort(): number {
    return this.bytes(2).readUInt16BE();
  }

  byteArray(): Buffer {
    return this.bytes(this.varInt());
  }
}
