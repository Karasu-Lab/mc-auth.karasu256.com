import net from 'node:net';
import { createBackend } from '../connect';
import { Connection } from './connection';
import { createD1 } from './d1';
import { startHttpServer } from './http';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function createRateLimiter(limit: number, periodMs: number): Env['VERIFY_RATE_LIMITER'] {
  const hits = new Map<string, number[]>();
  return {
    async limit({ key }) {
      const now = Date.now();
      const recent = (hits.get(key) ?? []).filter((at) => now - at < periodMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return { success: false };
      }
      hits.set(key, [...recent, now]);
      return { success: true };
    },
  };
}

const env = {
  APP_ENV: process.env.APP_ENV ?? 'production',
  ACCOUNTS_URL: required('ACCOUNTS_URL'),
  AUTH_API_URL: required('AUTH_API_URL'),
  INTERNAL_API_SECRET: required('INTERNAL_API_SECRET'),
  MC_AUTH_DB: createD1({
    accountId: required('CLOUDFLARE_ACCOUNT_ID'),
    databaseId: required('CLOUDFLARE_D1_DATABASE_ID'),
    apiToken: required('CLOUDFLARE_D1_API_TOKEN'),
  }),
  VERIFY_RATE_LIMITER: createRateLimiter(10, 60_000),
} as Env;
const backend = createBackend(env);

startHttpServer(env, Number(process.env.PORT ?? 3000));

net
  .createServer((socket) => {
    const connection = new Connection(
      {
        write: (data) => {
          socket.write(data);
        },
        end: () => {
          socket.end();
        },
      },
      backend
    );
    socket.on('data', (chunk: Buffer) => connection.receive(chunk));
    socket.on('error', () => socket.destroy());
  })
  .listen(25565);
