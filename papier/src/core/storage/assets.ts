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

export async function getAssetBytes(id: ID): Promise<Uint8Array | null> {
  const rec = await db.assets.get(id);
  return rec ? new Uint8Array(await rec.blob.arrayBuffer()) : null;
}

export async function getAsset(id: ID): Promise<AssetRecord | undefined> {
  return db.assets.get(id);
}
