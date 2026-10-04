import type { ID } from '../core/model/types';
import { db } from '../core/storage/db';
import { storeVerifiedAsset } from '../core/storage/assets';
import { apiFetch, apiJson, type Auth } from './api';

/**
 * Fichiers d'un carnet (PDF, images, audio), adressés par leur SHA-256 : on envoie ceux que le
 * serveur n'a pas, on télécharge ceux qui manquent ici. Un même fichier n'est transféré qu'une fois.
 */
export async function syncAssets(server: string, auth: Auth, ids: Iterable<ID>, canUpload: boolean) {
  const all = [...new Set(ids)];
  if (!all.length) return;
  const local = await db.assets.bulkGet(all);
  const here = all.filter((_, i) => local[i]);
  const absent = all.filter((_, i) => !local[i]);

  if (canUpload && here.length) {
    const { missing } = await apiJson<{ missing: ID[] }>(server, '/api/assets/missing', { auth, json: { ids: here } });
    for (const id of missing) {
      const rec = await db.assets.get(id);
      if (rec) await apiFetch(server, `/api/assets/${id}`, { method: 'PUT', auth, body: rec.blob, type: rec.mime });
    }
  }
  for (const id of absent) {
    try {
      await storeVerifiedAsset(id, await downloadAsset(server, auth, id));
    } catch {
      /* pas encore sur le serveur (envoi en cours depuis l'autre appareil) : nouvel essai plus tard */
    }
  }
}

export async function downloadAsset(server: string, auth: Auth, id: ID): Promise<Blob> {
  return (await apiFetch(server, `/api/assets/${id}`, { auth })).blob();
}
