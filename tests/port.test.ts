import { createServer, type Server } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { loadContent } from '../server/content';

const content = loadContent();

function occupy(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, () => resolve({ server, port: (server.address() as { port: number }).port }));
  });
}

describe('連接埠被佔用', () => {
  it('指定的連接埠被別的程式佔用時，自動改用下一個', async () => {
    const { server, port } = await occupy();
    const app = createApp({ content, botWaitMs: null });
    try {
      const actual = await app.listen(port);
      expect(actual).toBeGreaterThan(port);
      expect(actual).toBeLessThanOrEqual(port + 20);
      const res = await fetch(`http://localhost:${actual}/`);
      expect(res.status).toBeLessThan(500);
    } finally {
      await app.close();
      server.close();
    }
  });
});
