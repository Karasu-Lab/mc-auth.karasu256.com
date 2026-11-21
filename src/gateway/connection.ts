import { Cfb8, getServerKey, rsaDecrypt } from './crypto';
import { verifyJoin } from './mojang';
import { encodePacket, PacketReader, readVarInt, writeBytes, writeString } from './protocol';

export interface Backend {
  status(): Promise<{ version: { name: string; protocol: number } }>;
  join(uuid: string, name: string): Promise<void>;
  challenge(uuid: string, name: string, skin: string | null): Promise<{ sessionId: string; kickMessage: unknown }>;
  kick(sessionId: string): Promise<void>;
  leave(uuid: string): Promise<void>;
}

export interface Transport {
  write(data: Uint8Array): void | Promise<void>;
  end(): void | Promise<void>;
}

export class Connection {
  private buffer: Buffer = Buffer.alloc(0);
  private state: 'handshake' | 'status' | 'login' | 'encryption' | 'closed' = 'handshake';
  private protocol = 0;
  private name = '';
  private verifyToken = Buffer.alloc(0);
  private encryptor: Cfb8 | null = null;
  private decryptor: Cfb8 | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly transport: Transport,
    private readonly backend: Backend
  ) {}

  receive(chunk: Uint8Array): void {
    this.queue = this.queue
      .then(async () => {
        const data = Buffer.from(chunk);
        this.buffer = Buffer.concat([this.buffer, this.decryptor ? await this.decryptor.update(data) : data]);
        for (;;) {
          const length = readVarInt(this.buffer, 0);
          if (!length || this.buffer.length < length.size + length.value) return;
          const frame = this.buffer.subarray(length.size, length.size + length.value);
          this.buffer = this.buffer.subarray(length.size + length.value);
          await this.handle(frame);
        }
      })
      .catch(async () => {
        await this.transport.end();
      });
  }

  idle(): Promise<void> {
    return this.queue;
  }

  private async send(packet: Buffer): Promise<void> {
    await this.transport.write(this.encryptor ? await this.encryptor.update(packet) : packet);
  }

  private async handle(frame: Buffer): Promise<void> {
    const reader = new PacketReader(frame);
    const id = reader.varInt();

    if (this.state === 'handshake' && id === 0) {
      this.protocol = reader.varInt();
      reader.string();
      reader.unsignedShort();
      this.state = reader.varInt() === 1 ? 'status' : 'login';
    } else if (this.state === 'status' && id === 0) {
      const status = await this.backend.status();
      status.version.protocol = this.protocol;
      await this.send(encodePacket(0, writeString(JSON.stringify(status))));
    } else if (this.state === 'status' && id === 1) {
      await this.send(encodePacket(1, reader.bytes(8)));
      await this.transport.end();
    } else if (this.state === 'login' && id === 0) {
      this.name = reader.string();
      if (this.protocol < 761) return this.disconnect({ text: 'This Minecraft version is not supported.' });
      this.verifyToken = Buffer.from(crypto.getRandomValues(new Uint8Array(4)));
      this.state = 'encryption';
      const { publicKey } = await getServerKey();
      await this.send(
        encodePacket(1, writeString(''), writeBytes(publicKey), writeBytes(this.verifyToken), ...(this.protocol >= 766 ? [Buffer.from([1])] : []))
      );
    } else if (this.state === 'encryption' && id === 1) {
      await this.authenticate(reader);
    }
  }

  private async authenticate(reader: PacketReader): Promise<void> {
    const sharedSecret = await rsaDecrypt(reader.byteArray());
    if (!(await rsaDecrypt(reader.byteArray())).equals(this.verifyToken)) return this.disconnect({ text: 'Invalid verify token.' });
    this.state = 'closed';

    const { publicKey } = await getServerKey();
    const profile = await verifyJoin(this.name, sharedSecret, publicKey);
    this.encryptor = new Cfb8(sharedSecret, true);
    this.decryptor = new Cfb8(sharedSecret, false);
    if (!profile) return this.disconnect({ text: 'Failed to verify your Minecraft account.' });

    await this.backend.join(profile.id, profile.name);
    const challenge = await this.backend.challenge(profile.id, profile.name, profile.skin);
    await this.disconnect(challenge.kickMessage);
    await this.backend.kick(challenge.sessionId);
    await this.backend.leave(profile.id);
  }

  private async disconnect(message: unknown): Promise<void> {
    this.state = 'closed';
    await this.send(encodePacket(0, writeString(JSON.stringify(message))));
    await this.transport.end();
  }
}
