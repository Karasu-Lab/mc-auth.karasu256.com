import { and, eq, gt, lt } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { z } from 'zod';
import { BadRequestError, HttpError, NotFoundError, UnauthorizedError } from '@karasu-lab/types/server';
import { signRequest } from '@karasu-lab/utils/server/request-signature';
import * as schema from '../db/schema';
import { generateCode, hashCode } from './code';
import { fetchSessionUserId } from './session';
import { readSignedBody } from './signature';
import { buildStatus } from './status';

const challengeBodySchema = z.object({
  uuid: z.string().regex(/^[0-9a-f]{32}$/i),
  name: z.string().min(1).max(16),
  skin: z.string().nullable().optional(),
});
const eventBodySchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('join'), uuid: z.string().regex(/^[0-9a-f]{32}$/i), name: z.string().min(1).max(16) }),
  z.object({ event: z.literal('leave'), uuid: z.string().regex(/^[0-9a-f]{32}$/i) }),
  z.object({ event: z.literal('kick'), sessionId: z.string().min(1) }),
  z.object({ event: z.literal('status') }),
]);

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    throw new BadRequestError();
  }
}

export async function createChallenge(env: Env, request: Request) {
  const parsed = challengeBodySchema.safeParse(parseJson(await readSignedBody(env, request)));
  if (!parsed.success) throw new BadRequestError();
  return issueChallenge(env, parsed.data);
}

export async function issueChallenge(env: Env, data: z.infer<typeof challengeBodySchema>) {
  const db = drizzle(env.MC_AUTH_DB, { schema });
  const now = new Date();
  await db.delete(schema.mcAuthSession).where(lt(schema.mcAuthSession.expiresAt, now));

  const id = crypto.randomUUID();
  const code = generateCode();
  await db.insert(schema.mcAuthSession).values({
    id,
    mcUuid: data.uuid.toLowerCase(),
    mcName: data.name,
    skin: data.skin ?? null,
    rawCode: code,
    expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
    createdAt: now,
  });
  return { sessionId: id, code, kickMessage: { text: `Verification code: ${code}`, color: 'gold' } };
}

export async function handleEvent(env: Env, request: Request) {
  const parsed = eventBodySchema.safeParse(parseJson(await readSignedBody(env, request)));
  if (!parsed.success) throw new BadRequestError();
  return applyEvent(env, parsed.data);
}

export async function applyEvent(env: Env, event: z.infer<typeof eventBodySchema>) {
  const db = drizzle(env.MC_AUTH_DB, { schema });
  if (event.event === 'join') {
    await db
      .insert(schema.mcOnlinePlayer)
      .values({ mcUuid: event.uuid.toLowerCase(), mcName: event.name, joinedAt: new Date() })
      .onConflictDoUpdate({ target: schema.mcOnlinePlayer.mcUuid, set: { mcName: event.name, joinedAt: new Date() } });
  } else if (event.event === 'leave') {
    await db.delete(schema.mcOnlinePlayer).where(eq(schema.mcOnlinePlayer.mcUuid, event.uuid.toLowerCase()));
  } else if (event.event === 'kick') {
    const [row] = await db.select().from(schema.mcAuthSession).where(eq(schema.mcAuthSession.id, event.sessionId));
    if (!row || row.status !== 'pending' || !row.rawCode) throw new NotFoundError();
    await db
      .update(schema.mcAuthSession)
      .set({ codeHash: await hashCode(row.rawCode, row.id), rawCode: null, status: 'kicked' })
      .where(eq(schema.mcAuthSession.id, row.id));
  }
  return { ok: true, status: await buildStatus(env) };
}

export async function verifyChallenge(env: Env, request: Request, rawCode: string | undefined) {
  const code = z
    .string()
    .regex(/^[A-Z0-9]{6}$/)
    .safeParse(rawCode);
  if (!code.success) throw new BadRequestError();

  const userId = await fetchSessionUserId(env, request);
  if (!userId) throw new UnauthorizedError();
  const { success } = await env.VERIFY_RATE_LIMITER.limit({ key: userId });
  if (!success) throw new HttpError(429, { error: 'Too Many Requests' });

  const db = drizzle(env.MC_AUTH_DB, { schema });
  const candidates = await db
    .select()
    .from(schema.mcAuthSession)
    .where(and(eq(schema.mcAuthSession.status, 'kicked'), gt(schema.mcAuthSession.expiresAt, new Date())));
  let matched: (typeof candidates)[number] | undefined;
  for (const row of candidates) {
    if (row.codeHash === (await hashCode(code.data, row.id))) matched = row;
  }
  if (!matched) throw new NotFoundError();

  const url = `${env.AUTH_API_URL}/api/internal/users/${encodeURIComponent(userId)}/minecraft-link`;
  const body = JSON.stringify({ uuid: matched.mcUuid });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...signRequest({ secret: env.INTERNAL_API_SECRET, method: 'POST', url, body }) },
    body,
  });
  if (!res.ok) throw new HttpError(res.status === 409 ? 409 : 502, { error: res.status === 409 ? 'Conflict' : 'Bad Gateway' });

  await db
    .insert(schema.mcProfile)
    .values({ mcUuid: matched.mcUuid, mcName: matched.mcName, skin: matched.skin, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.mcProfile.mcUuid,
      set: { mcName: matched.mcName, skin: matched.skin, updatedAt: new Date() },
    });
  await db.update(schema.mcAuthSession).set({ status: 'verified', codeHash: null }).where(eq(schema.mcAuthSession.id, matched.id));
  return { linked: true };
}

export async function getProfile(env: Env, request: Request) {
  await readSignedBody(env, request);
  const uuid = z
    .string()
    .regex(/^[0-9a-f]{32}$/i)
    .safeParse(new URL(request.url).searchParams.get('uuid'));
  if (!uuid.success) throw new BadRequestError();

  const db = drizzle(env.MC_AUTH_DB, { schema });
  const [row] = await db.select().from(schema.mcProfile).where(eq(schema.mcProfile.mcUuid, uuid.data.toLowerCase()));
  if (!row) throw new NotFoundError();
  return { name: row.mcName, skin: row.skin };
}
