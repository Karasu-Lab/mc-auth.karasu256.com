import net from 'node:net';
import { type Backend, Connection } from './connection';
import { postToWorker } from './worker';

const backend: Backend = {
  async status() {
    return (await postToWorker<{ status: Awaited<ReturnType<Backend['status']>> }>('/', { event: 'status' })).status;
  },
  async join(uuid, name) {
    await postToWorker('/', { event: 'join', uuid, name });
  },
  challenge: (uuid, name, skin) => postToWorker('/api/mc/challenge', { uuid, name, skin }),
  async kick(sessionId) {
    await postToWorker('/', { event: 'kick', sessionId });
  },
  async leave(uuid) {
    await postToWorker('/', { event: 'leave', uuid });
  },
};

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
