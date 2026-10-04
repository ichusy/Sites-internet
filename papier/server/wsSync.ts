import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import { AccessError, resolveRoom, userFromToken } from './access.ts';
import type { Store } from './db.ts';
import type { Connection, DocManager, LiveDoc } from './docs.ts';

/** Types de messages du protocole y-websocket. */
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_AUTH = 2;
const PING_MS = 30_000;

/** Les connexions WebSocket d'un document reçoivent ses mises à jour et l'awareness (curseurs, présence). */
const wired = new WeakSet<LiveDoc>();

function wire(entry: LiveDoc) {
  if (wired.has(entry)) return;
  wired.add(entry);
  entry.doc.on('update', (update: Uint8Array, origin: unknown) => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const msg = encoding.toUint8Array(encoder);
    for (const c of entry.conns) if (c !== origin) c.send(msg);
  });
  entry.awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    const changed = [...added, ...updated, ...removed];
    const conn = origin as Connection | null;
    if (conn?.awarenessIds) {
      for (const id of added) conn.awarenessIds.add(id);
      for (const id of removed) conn.awarenessIds.delete(id);
    }
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(entry.awareness, changed));
    const msg = encoding.toUint8Array(encoder);
    for (const c of entry.conns) c.send(msg);
  });
}

/** Message « accès refusé » du protocole (le client cesse de se reconnecter). */
function permissionDenied(reason: string): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AUTH);
  encoding.writeVarUint(encoder, 0);
  encoding.writeVarString(encoder, reason);
  return encoding.toUint8Array(encoder);
}

/**
 * Connexion WebSocket : /sync/<salon>?token=… (compte) ou ?share=… (lien de partage).
 * Un accès en lecture seule reçoit le document et les curseurs, mais ses modifications sont ignorées.
 */
export function handleSocket(ws: WebSocket, req: IncomingMessage, store: Store, docs: DocManager) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const room = decodeURIComponent(url.pathname.replace(/^\/sync\/?/, ''));
  let access;
  try {
    const user = userFromToken(store, url.searchParams.get('token'));
    access = resolveRoom(store, room, user, url.searchParams.get('share'));
  } catch (err) {
    const reason = err instanceof AccessError ? err.message : 'Erreur';
    ws.send(permissionDenied(reason), () => ws.close(4403, 'denied'));
    return;
  }
  const { readOnly } = access;
  const entry = docs.get(access.docId);
  wire(entry);

  const conn: Connection = {
    awarenessIds: new Set(),
    send(data) {
      if (ws.readyState !== ws.OPEN) return;
      ws.send(data, (err) => err && ws.close());
    },
  };
  docs.attach(entry, conn);

  ws.binaryType = 'arraybuffer';
  ws.on('message', (raw: ArrayBuffer | Buffer) => {
    try {
      const data = raw instanceof ArrayBuffer ? new Uint8Array(raw) : new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
      const decoder = decoding.createDecoder(data);
      const encoder = encoding.createEncoder();
      const type = decoding.readVarUint(decoder);
      if (type === MESSAGE_SYNC) {
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        const syncType = decoding.readVarUint(decoder);
        if (syncType === syncProtocol.messageYjsSyncStep1) syncProtocol.readSyncStep1(decoder, encoder, entry.doc);
        else if (!readOnly && syncType === syncProtocol.messageYjsSyncStep2) syncProtocol.readSyncStep2(decoder, entry.doc, conn);
        else if (!readOnly && syncType === syncProtocol.messageYjsUpdate) syncProtocol.readUpdate(decoder, entry.doc, conn);
        if (encoding.length(encoder) > 1) conn.send(encoding.toUint8Array(encoder));
      } else if (type === MESSAGE_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(entry.awareness, decoding.readVarUint8Array(decoder), conn);
      }
    } catch (err) {
      console.error('[sync] message invalide', err);
    }
  });

  let alive = true;
  ws.on('pong', () => (alive = true));
  const ping = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, PING_MS);
  ping.unref?.();

  ws.on('close', () => {
    clearInterval(ping);
    docs.detach(entry, conn);
  });

  // Début de la synchronisation : notre état, puis les curseurs déjà présents.
  const step1 = encoding.createEncoder();
  encoding.writeVarUint(step1, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(step1, entry.doc);
  conn.send(encoding.toUint8Array(step1));
  const states = entry.awareness.getStates();
  if (states.size) {
    const aw = encoding.createEncoder();
    encoding.writeVarUint(aw, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(aw, awarenessProtocol.encodeAwarenessUpdate(entry.awareness, [...states.keys()]));
    conn.send(encoding.toUint8Array(aw));
  }
}
