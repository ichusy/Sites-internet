import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import { REMOTE_ORIGIN } from '../core/model/notebookDoc';
import { apiFetch, type Auth } from './api';

/**
 * Synchronisation d'un document Yjs par HTTP, en deux échanges :
 *  1. vecteur d'état du serveur ;
 *  2. envoi de ce qui lui manque (+ notre vecteur), réception de ce qui nous manque.
 * Utilisée en arrière-plan pour les carnets fermés ; les carnets ouverts passent par WebSocket.
 */
export async function syncDoc(server: string, room: string, doc: Y.Doc, auth: Auth, opts: { push?: boolean; signal?: AbortSignal } = {}) {
  const path = `/api/doc/${encodeURIComponent(room)}`;
  const serverSv = new Uint8Array(await (await apiFetch(server, `${path}/sv`, { auth, signal: opts.signal })).arrayBuffer());
  const encoder = encoding.createEncoder();
  encoding.writeVarUint8Array(encoder, Y.encodeStateVector(doc));
  encoding.writeVarUint8Array(encoder, opts.push === false ? new Uint8Array([0, 0]) : Y.encodeStateAsUpdate(doc, serverSv));
  const res = await apiFetch(server, `${path}/sync`, {
    auth,
    body: encoding.toUint8Array(encoder) as Uint8Array<ArrayBuffer>,
    type: 'application/octet-stream',
    signal: opts.signal,
  });
  const diff = new Uint8Array(await res.arrayBuffer());
  if (diff.byteLength > 2) Y.applyUpdate(doc, diff, REMOTE_ORIGIN);
}
