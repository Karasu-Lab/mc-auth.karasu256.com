import { signRequest } from '@karasu-lab/utils/server/request-signature';

export async function postToWorker<T>(path: string, payload: unknown): Promise<T> {
  const url = new URL(path, process.env.MC_AUTH_URL).toString();
  const body = JSON.stringify(payload);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...signRequest({ secret: process.env.INTERNAL_API_SECRET!, method: 'POST', url, body }) },
    body,
  });
  if (!res.ok) throw new Error(`${path} responded with ${res.status}`);
  return (await res.json()) as T;
}
