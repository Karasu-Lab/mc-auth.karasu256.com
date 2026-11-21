function corsHeaders(env: Env, origin: string | null): Record<string, string> {
  if (!origin || origin !== new URL(env.ACCOUNTS_URL).origin) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function handlePreflight(env: Env, request: Request): Response | null {
  if (request.method !== 'OPTIONS') return null;
  return new Response(null, { status: 204, headers: corsHeaders(env, request.headers.get('origin')) });
}

export function withCors(env: Env, request: Request, response: Response): Response {
  const headers = corsHeaders(env, request.headers.get('origin'));
  if (Object.keys(headers).length === 0) return response;
  const copy = new Response(response.body, response);
  for (const [key, value] of Object.entries(headers)) copy.headers.set(key, value);
  return copy;
}
