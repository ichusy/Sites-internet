import type { Store, UserRow } from './db.ts';
import { hashToken } from './auth.ts';

export interface Access {
  docId: string;
  readOnly: boolean;
  user: UserRow | null;
  /** Accès obtenu par un lien de partage (et non par le propriétaire). */
  share: { token: string; mode: 'view' | 'edit' } | null;
}

export class AccessError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const NOTEBOOK_ID = /^[a-z0-9_-]{4,64}$/i;

export function userFromToken(store: Store, token: string | null | undefined, now = Date.now()): UserRow | null {
  return token ? (store.sessionUser(hashToken(token), now) ?? null) : null;
}

/**
 * Droits sur un « salon » de synchronisation :
 *  - `lib`        : la bibliothèque du compte connecté (dossiers, carnets, modèles) ;
 *  - `nb-<id>`    : un carnet. Son propriétaire est le premier compte qui le synchronise ;
 *                   les autres n'y accèdent que par un lien de partage (lecture ou modification).
 */
export function resolveRoom(store: Store, room: string, user: UserRow | null, shareToken: string | null, now = Date.now()): Access {
  if (room === 'lib') {
    if (!user) throw new AccessError(401, 'Connexion requise.');
    const docId = `lib:${user.id}`;
    store.addDoc(docId, user.id, now);
    return { docId, readOnly: false, user, share: null };
  }
  const m = /^nb-(.+)$/.exec(room);
  if (!m || !NOTEBOOK_ID.test(m[1])) throw new AccessError(404, 'Salon inconnu.');
  const docId = `nb:${m[1]}`;
  const existing = store.doc(docId);
  if (user && (!existing || existing.owner_id === user.id)) {
    if (!existing) store.addDoc(docId, user.id, now);
    return { docId, readOnly: false, user, share: null };
  }
  const share = shareToken ? store.share(shareToken) : undefined;
  if (share && share.doc_id === docId) {
    return { docId, readOnly: share.mode !== 'edit', user, share: { token: share.token, mode: share.mode } };
  }
  throw new AccessError(user ? 403 : 401, user ? 'Ce carnet ne vous appartient pas.' : 'Connexion requise.');
}
