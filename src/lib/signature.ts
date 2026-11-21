import { UnauthorizedError } from '@karasu-lab/types/server';
import { verifyRequest } from '@karasu-lab/utils/server/request-signature';

export async function readSignedBody(env: Env, request: Request): Promise<string> {
  const body = await request.text();
  const result = verifyRequest({ secret: env.INTERNAL_API_SECRET, method: request.method, url: request.url, headers: request.headers, body });
  if (result.status !== 'valid') throw new UnauthorizedError();
  return body;
}
