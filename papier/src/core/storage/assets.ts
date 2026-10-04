import type { AssetRecord, ID } from '../model/types';
import { db } from './db';

export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  const digest = await crypto.subtle.digest('SHA-256', buf as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Enregistre un fichier (PDF, image…) ; un même contenu n'est stocké qu'une fois. */
export async function putAsset(blob: Blob): Promise<ID> {
  const bytes = await blob.arrayBuffer();
  const id = await sha256Hex(bytes);
  if (!(await db.assets.get(id))) {
    const record: AssetRecord = { id, mime: blob.type || 'application/octet-stream', size: blob.size, blob, createdAt: Date.now() };
    await db.assets.put(record);
  }
  return id;
}

/** Récupère un fichier absent de l'appareil (fourni par la synchronisation). */
type RemoteFetcher = (id: ID) => Promise<Blob | null>;
let remoteFetcher: RemoteFetcher | null = null;
const pending = new Map<ID, Promise<AssetRecord | undefined>>();

export function setRemoteAssetFetcher(fn: RemoteFetcher | null) {
  remoteFetcher = fn;
}

/** Enregistre un fichier téléchargé après avoir vérifié qu'il correspond à son empreinte. */
export async function storeVerifiedAsset(id: ID, blob: Blob): Promise<AssetRecord | undefined> {
  if ((await sha256Hex(await blob.arrayBuffer())) !== id) return undefined;
  const record: AssetRecord = { id, mime: blob.type || 'application/octet-stream', size: blob.size, blob, createdAt: Date.now() };
  await db.assets.put(record);
  return record;
}

export async function getAssetBytes(id: ID): Promise<Uint8Array | null> {
  const rec = await getAsset(id);
  return rec ? new Uint8Array(await rec.blob.arrayBuffer()) : null;
}

/** Fichier local, ou téléchargé depuis le serveur de synchronisation s'il manque encore. */
export async function getAsset(id: ID): Promise<AssetRecord | undefined> {
  const local = await db.assets.get(id);
  if (local || !remoteFetcher) return local;
  let p = pending.get(id);
  if (!p) {
    const fetcher = remoteFetcher;
    p = (async () => {
      const blob = await fetcher(id).catch(() => null);
      return blob ? storeVerifiedAsset(id, blob) : undefined;
    })().finally(() => pending.delete(id));
    pending.set(id, p);
  }
  return p;
}
