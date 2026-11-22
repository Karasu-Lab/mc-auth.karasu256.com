import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { HttpError, UnauthorizedError } from '@karasu-lab/types/server';
import { log } from '@karasu-lab/utils/server/log';
import { createChallenge, getProfile, handleEvent, verifyChallenge } from '../lib/challenge';
import { handlePreflight, withCors } from '../lib/cors';
import { fetchSession } from '../lib/session';

async function toRequest(req: IncomingMessage): Promise<Request> {
  const proto = String(req.headers['x-forwarded-proto'] ?? 'http').split(',')[0].trim();
  const url = new URL(req.url ?? '/', `${proto}://${req.headers.host}`);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  const method = req.method ?? 'GET';
  if (method === 'GET' || method === 'HEAD') return new Request(url, { method, headers });
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return new Request(url, { method, headers, body: Buffer.concat(chunks) });
}

async function route(env: Env, request: Request): Promise<Response> {
  const { pathname, searchParams } = new URL(request.url);
  switch (`${request.method} ${pathname}`) {
    case 'POST /':
      return Response.json(await handleEvent(env, request));
    case 'GET /api/auth/get-session': {
      const session = await fetchSession(env, request);
      if (!session) throw new UnauthorizedError();
      return Response.json(session);
    }
    case 'GET /api/mc/profile':
      return Response.json(await getProfile(env, request));
    case 'POST /api/mc/challenge':
      return Response.json(await createChallenge(env, request));
    case 'GET /api/mc/verify':
      return Response.json(await verifyChallenge(env, request, searchParams.get('code') ?? undefined));
    default:
      return Response.json({ error: 'Not Found' }, { status: 404 });
  }
}

async function handle(env: Env, request: Request): Promise<Response> {
  const preflight = handlePreflight(env, request);
  if (preflight) return preflight;
  try {
    return withCors(env, request, await route(env, request));
  } catch (error) {
    if (error instanceof HttpError) {
      return withCors(env, request, Response.json(error.body, { status: error.status, headers: error.headers }));
    }
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
    return withCors(env, request, Response.json({ error: 'Internal Server Error' }, { status: 500 }));
  }
}

async function send(res: ServerResponse, response: Response) {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

export function startHttpServer(env: Env, port: number) {
  createServer((req, res) => {
    toRequest(req)
      .then((request) => handle(env, request))
      .then((response) => send(res, response))
      .catch(() => {
        res.writeHead(400).end();
      });
  }).listen(port);
}
