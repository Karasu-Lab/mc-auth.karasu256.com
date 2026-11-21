import { env as cfEnv } from 'cloudflare:workers';
import { Elysia } from 'elysia';
import { CloudflareAdapter } from 'elysia/adapter/cloudflare-worker';
import { HttpError, UnauthorizedError } from '@karasu-lab/types/server';
import { log } from '@karasu-lab/utils/server/log';
import { handleConnection } from './connect';
import { createChallenge, getProfile, handleEvent, verifyChallenge } from './lib/challenge';
import { handlePreflight, withCors } from './lib/cors';
import { fetchSession } from './lib/session';

const env = cfEnv as Env;

const app = new Elysia({ adapter: CloudflareAdapter, aot: false, normalize: 'typebox' })
  .parser('none', () => ({}))
  .onError(({ code, error, request }) => {
    if (error instanceof HttpError) return Response.json(error.body, { status: error.status, headers: error.headers });
    if (code === 'NOT_FOUND') return Response.json({ error: 'Not Found' }, { status: 404 });
    log(
      'request_error',
      {
        name: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message : String(error),
        method: request.method,
        path: new URL(request.url).pathname,
      },
      'error'
    );
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  })
  .post('/', async ({ request }) => handleEvent(env, request), { parse: 'none' })
  .get('/api/auth/get-session', async ({ request }) => {
    const session = await fetchSession(env, request);
    if (!session) throw new UnauthorizedError();
    return session;
  })
  .get('/api/mc/profile', async ({ request }) => getProfile(env, request), { parse: 'none' })
  .post('/api/mc/challenge', async ({ request }) => createChallenge(env, request), { parse: 'none' })
  .get('/api/mc/verify', async ({ request }) => verifyChallenge(env, request, new URL(request.url).searchParams.get('code') ?? undefined));

export default {
  fetch: async (request: Request): Promise<Response> => {
    const preflight = handlePreflight(env, request);
    if (preflight) return preflight;
    return withCors(env, request, await app.fetch(request));
  },
  connect: (socket: Socket): Promise<void> => handleConnection(env, socket),
};
