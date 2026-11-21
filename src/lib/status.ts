import { count } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { createDocument, evaluateStatus, parseText } from '@groundsgg/motd';
import * as schema from '../db/schema';

export async function buildStatus(env: Env) {
  const db = drizzle(env.MC_AUTH_DB, { schema });
  const [{ online }] = await db.select({ online: count() }).from(schema.mcOnlinePlayer);

  const document = createDocument(parseText('<gray>{{players}} online', 'minimessage').value!);
  const status = evaluateStatus(document, {
    base: { version: { protocol: 767, name: '1.21.1' }, players: { online, max: 0, sample: [] }, description: '' },
    clientProtocol: 767,
    values: {},
  });
  return status.value;
}
