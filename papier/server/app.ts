import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import type { Config } from './config.ts';
import { Store } from './db.ts';
import { DocManager } from './docs.ts';
import { createHandler } from './http.ts';
import { handleSocket } from './wsSync.ts';

export interface PapierServer {
  server: Server;
  store: Store;
  docs: DocManager;
  /** Port effectif (utile avec PORT=0 dans les tests). */
  port: number;
  close(): Promise<void>;
}

/** Démarre le serveur : API HTTP, synchronisation WebSocket (/sync/…) et application. */
export async function startServer(config: Config): Promise<PapierServer> {
  const store = new Store(config.dataDir);
  const docs = new DocManager(store);
  const server = createServer(createHandler(config, store, docs));
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });

  server.on('upgrade', (req, socket, head) => {
    if (!(req.url ?? '').startsWith('/sync/')) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => handleSocket(ws, req, store, docs));
  });

  await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    server,
    store,
    docs,
    port,
    async close() {
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
      await closed;
      docs.close();
      store.close();
    },
  };
}
