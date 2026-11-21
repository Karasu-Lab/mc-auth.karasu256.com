import { z } from 'zod';

export async function fetchSession(env: Env, request: Request): Promise<Record<string, unknown> | null> {
  const cookie = request.headers.get('cookie');
  if (!cookie) return null;
  const res = await fetch(`${env.AUTH_API_URL}/api/auth/get-session`, { headers: { cookie }, cache: 'no-store' }).catch(() => null);
  if (!res?.ok) return null;
  const parsed = z
    .object({ user: z.object({ id: z.string() }).nullish() })
    .passthrough()
    .safeParse(await res.json().catch(() => null));
  return parsed.success && parsed.data.user ? parsed.data : null;
}

export async function fetchSessionUserId(env: Env, request: Request): Promise<string | null> {
  const session = await fetchSession(env, request);
  return (session?.user as { id: string } | undefined)?.id ?? null;
}
