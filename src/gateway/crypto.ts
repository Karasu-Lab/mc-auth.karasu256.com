interface ServerKey {
  publicKey: Buffer;
  n: bigint;
  d: bigint;
  size: number;
}

let serverKey: Promise<ServerKey> | null = null;

function toBigInt(base64Url: string): bigint {
  return BigInt(`0x${Buffer.from(base64Url, 'base64url').toString('hex')}`);
}

export function getServerKey(): Promise<ServerKey> {
  serverKey ??= (async () => {
    const pair = (await crypto.subtle.generateKey(
      { name: 'RSA-OAEP', modulusLength: 1024, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-1' },
      true,
      ['encrypt', 'decrypt']
    )) as CryptoKeyPair;
    const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
    return {
      publicKey: Buffer.from((await crypto.subtle.exportKey('spki', pair.publicKey)) as ArrayBuffer),
      n: toBigInt(jwk.n!),
      d: toBigInt(jwk.d!),
      size: 128,
    };
  })();
  return serverKey;
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let value = base % modulus;
  let remaining = exponent;
  while (remaining > 0n) {
    if (remaining & 1n) result = (result * value) % modulus;
    value = (value * value) % modulus;
    remaining >>= 1n;
  }
  return result;
}

export async function rsaDecrypt(data: Buffer): Promise<Buffer> {
  const { n, d, size } = await getServerKey();
  const plain = modPow(BigInt(`0x${data.toString('hex')}`), d, n)
    .toString(16)
    .padStart(size * 2, '0');
  const block = Buffer.from(plain, 'hex');
  if (block[0] !== 0 || block[1] !== 2) throw new Error('Invalid RSA padding');
  const separator = block.indexOf(0, 2);
  if (separator < 0) throw new Error('Invalid RSA padding');
  return block.subarray(separator + 1);
}

export class Cfb8 {
  private readonly register: Buffer;
  private keyPromise: Promise<CryptoKey>;

  constructor(
    secret: Buffer,
    private readonly encrypting: boolean
  ) {
    this.register = Buffer.from(secret);
    this.keyPromise = crypto.subtle.importKey('raw', secret, 'AES-CBC', false, ['encrypt']);
  }

  async update(data: Buffer): Promise<Buffer> {
    const key = await this.keyPromise;
    const output = Buffer.alloc(data.length);
    for (let index = 0; index < data.length; index++) {
      const block = await crypto.subtle.encrypt({ name: 'AES-CBC', iv: new Uint8Array(16) }, key, this.register);
      output[index] = data[index] ^ new Uint8Array(block)[0];
      this.register.copyWithin(0, 1);
      this.register[15] = this.encrypting ? output[index] : data[index];
    }
    return output;
  }
}
