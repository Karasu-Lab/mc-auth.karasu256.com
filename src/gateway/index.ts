import {
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  privateDecrypt,
  randomBytes,
  constants,
  type Cipheriv,
  type Decipheriv,
} from 'node:crypto';
import net from 'node:net';
import { verifyJoin } from './mojang';
import { encodePacket, PacketReader, readVarInt, writeBytes, writeString } from './protocol';
import { postToWorker } from './worker';

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 1024,
  publicKeyEncoding: { type: 'spki', format: 'der' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

interface Status {
  version: { name: string; protocol: number };
}

interface Challenge {
  sessionId: string;
  kickMessage: unknown;
}

class Connection {
  private buffer: Buffer = Buffer.alloc(0);
  private state: 'handshake' | 'status' | 'login' | 'encryption' | 'closed' = 'handshake';
  private protocol = 0;
  private name = '';
  private verifyToken = Buffer.alloc(0);
  private cipher: Cipheriv | null = null;
  private decipher: Decipheriv | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly socket: net.Socket) {
    socket.on('data', (chunk: Buffer) => {
      try {
        this.buffer = Buffer.concat([this.buffer, this.decipher ? this.decipher.update(chunk) : chunk]);
        this.drain();
      } catch {
        socket.destroy();
      }
    });
    socket.on('error', () => socket.destroy());
  }

  private drain(): void {
    for (;;) {
      const length = readVarInt(this.buffer, 0);
      if (!length || this.buffer.length < length.size + length.value) return;
      const frame = this.buffer.subarray(length.size, length.size + length.value);
      this.buffer = this.buffer.subarray(length.size + length.value);
      this.queue = this.queue
        .then(() => this.handle(frame))
        .catch(() => {
          this.socket.destroy();
        });
    }
  }

  private send(packet: Buffer): void {
    this.socket.write(this.cipher ? this.cipher.update(packet) : packet);
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
      const { status } = await postToWorker<{ status: Status }>('/', { event: 'status' });
      status.version.protocol = this.protocol;
      this.send(encodePacket(0, writeString(JSON.stringify(status))));
    } else if (this.state === 'status' && id === 1) {
      this.send(encodePacket(1, reader.bytes(8)));
      this.socket.end();
    } else if (this.state === 'login' && id === 0) {
      this.name = reader.string();
      if (this.protocol < 761) return this.disconnect({ text: 'This Minecraft version is not supported.' });
      this.verifyToken = randomBytes(4);
      this.state = 'encryption';
      this.send(
        encodePacket(1, writeString(''), writeBytes(publicKey), writeBytes(this.verifyToken), ...(this.protocol >= 766 ? [Buffer.from([1])] : []))
      );
    } else if (this.state === 'encryption' && id === 1) {
      await this.authenticate(reader);
    }
  }

  private async authenticate(reader: PacketReader): Promise<void> {
    const decrypt = (data: Buffer) => privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_PADDING }, data);
    const sharedSecret = decrypt(reader.byteArray());
    if (!decrypt(reader.byteArray()).equals(this.verifyToken)) return this.disconnect({ text: 'Invalid verify token.' });
    this.state = 'closed';

    const profile = await verifyJoin(this.name, sharedSecret, publicKey);
    this.cipher = createCipheriv('aes-128-cfb8', sharedSecret, sharedSecret);
    this.decipher = createDecipheriv('aes-128-cfb8', sharedSecret, sharedSecret);
    if (!profile) return this.disconnect({ text: 'Failed to verify your Minecraft account.' });

    await postToWorker('/', { event: 'join', uuid: profile.id, name: profile.name });
    const challenge = await postToWorker<Challenge>('/api/mc/challenge', { uuid: profile.id, name: profile.name, skin: profile.skin });
    this.disconnect(challenge.kickMessage);
    await postToWorker('/', { event: 'kick', sessionId: challenge.sessionId });
    await postToWorker('/', { event: 'leave', uuid: profile.id });
  }

  private disconnect(message: unknown): void {
    this.state = 'closed';
    this.send(encodePacket(0, writeString(JSON.stringify(message))));
    this.socket.end();
  }
}

net.createServer((socket) => new Connection(socket)).listen(25565);
