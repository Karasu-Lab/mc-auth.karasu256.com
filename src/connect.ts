import { type Backend, Connection } from './gateway/connection';
import { applyEvent, issueChallenge } from './lib/challenge';

function createBackend(env: Env): Backend {
  return {
    async status() {
      return (await applyEvent(env, { event: 'status' })).status as Awaited<ReturnType<Backend['status']>>;
    },
    async join(uuid, name) {
      await applyEvent(env, { event: 'join', uuid, name });
    },
    challenge: (uuid, name, skin) => issueChallenge(env, { uuid, name, skin }),
    async kick(sessionId) {
      await applyEvent(env, { event: 'kick', sessionId });
    },
    async leave(uuid) {
      await applyEvent(env, { event: 'leave', uuid });
    },
  };
}

export async function handleConnection(env: Env, socket: Socket): Promise<void> {
  const writer = socket.writable.getWriter();
  const connection = new Connection(
    {
      write: (data) => writer.write(data),
      end: () => writer.close(),
    },
    createBackend(env)
  );
  for await (const chunk of socket.readable) connection.receive(chunk);
  await connection.idle();
}
