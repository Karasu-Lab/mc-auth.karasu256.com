function signedHexDigest(digest: Buffer): string {
  const bytes = Buffer.from(digest);
  const negative = (bytes[0] & 0x80) !== 0;
  if (negative) {
    let carry = true;
    for (let index = bytes.length - 1; index >= 0; index--) {
      bytes[index] = ~bytes[index] & 0xff;
      if (carry) {
        if (bytes[index] === 0xff) {
          bytes[index] = 0;
        } else {
          bytes[index]++;
          carry = false;
        }
      }
    }
  }
  const hex = bytes.toString('hex').replace(/^0+/, '') || '0';
  return negative ? `-${hex}` : hex;
}

interface HasJoinedResponse {
  id: string;
  name: string;
  properties?: { name: string; value: string }[];
}

async function fetchSkinDataUrl(profile: HasJoinedResponse): Promise<string | null> {
  const textures = profile.properties?.find((property) => property.name === 'textures')?.value;
  if (!textures) return null;
  const skinUrl = (JSON.parse(Buffer.from(textures, 'base64').toString('utf8')) as { textures?: { SKIN?: { url: string } } }).textures?.SKIN?.url;
  if (!skinUrl) return null;
  const res = await fetch(skinUrl).catch(() => null);
  if (!res?.ok) return null;
  return `data:image/png;base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
}

export async function verifyJoin(
  name: string,
  sharedSecret: Buffer,
  publicKey: Buffer
): Promise<{ id: string; name: string; skin: string | null } | null> {
  const digest = Buffer.from(await crypto.subtle.digest('SHA-1', Buffer.concat([sharedSecret, publicKey])));
  const url = new URL('https://sessionserver.mojang.com/session/minecraft/hasJoined');
  url.searchParams.set('username', name);
  url.searchParams.set('serverId', signedHexDigest(digest));
  const res = await fetch(url).catch(() => null);
  if (res?.status !== 200) return null;
  const profile = (await res.json()) as HasJoinedResponse;
  return { id: profile.id, name: profile.name, skin: await fetchSkinDataUrl(profile) };
}
