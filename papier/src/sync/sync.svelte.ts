import Dexie from 'dexie';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { WebsocketProvider } from 'y-websocket';
import { registerRemoteOrigin } from '../core/model/notebookDoc';
import type { ID, NotebookRecord } from '../core/model/types';
import { setRemoteAssetFetcher } from '../core/storage/assets';
import { db } from '../core/storage/db';
import { withNotebookDoc } from '../core/storage/notebookStore';
import { buildIndex } from '../core/search/notebookIndex';
import { assetIdsOf } from '../io/archive';
import { ApiError, apiFetch, apiJson, normalizeServer, wsBase, type Auth, type UserInfo } from './api';
import { downloadAsset, syncAssets } from './assetSync';
import { syncDoc } from './docSync';
import { LibraryBridge } from './libraryBridge';

/**
 * Synchronisation avec un serveur Papier (facultative) :
 *  - la bibliothèque du compte (dossiers, carnets, modèles) en temps réel par WebSocket ;
 *  - le contenu des carnets fermés en arrière-plan par HTTP, celui du carnet ouvert en temps réel ;
 *  - les fichiers (PDF, images, audio) envoyés et reçus une seule fois.
 * Tout reste utilisable hors ligne : les modifications sont fusionnées au retour du réseau (Yjs).
 */

export interface AccountData {
  server: string;
  token: string;
  user: UserInfo;
}

export type SyncStatus = 'off' | 'connecting' | 'synced' | 'syncing' | 'offline' | 'error';

const ACCOUNT_KEY = 'papier-account';
/** Synchronisation périodique de secours (les changements sont aussi signalés en direct). */
const PASS_EVERY = 60_000;

function loadAccount(): AccountData | null {
  try {
    const raw = localStorage.getItem(ACCOUNT_KEY);
    return raw ? (JSON.parse(raw) as AccountData) : null;
  } catch {
    return null;
  }
}

function saveAccount(a: AccountData | null) {
  try {
    if (a) localStorage.setItem(ACCOUNT_KEY, JSON.stringify(a));
    else localStorage.removeItem(ACCOUNT_KEY);
  } catch {
    /* stockage indisponible */
  }
}

/** État affiché par l'interface. */
export const syncState = $state<{
  account: AccountData | null;
  status: SyncStatus;
  /** Date de la dernière synchronisation complète réussie. */
  lastSync: number;
  error: string;
  /** Carnets restant à synchroniser pendant un passage. */
  pending: number;
}>({ account: loadAccount(), status: 'off', lastSync: 0, error: '', pending: 0 });

/** Serveur et droits pour un carnet : le compte, ou le lien de partage reçu. */
function target(nb: NotebookRecord): { server: string; auth: Auth; canWrite: boolean } | null {
  if (nb.share) return { server: nb.share.server, auth: { share: nb.share.token }, canWrite: nb.share.mode === 'edit' };
  const a = syncState.account;
  return a ? { server: a.server, auth: { token: a.token }, canWrite: true } : null;
}

class SyncEngine {
  private libDoc: Y.Doc | null = null;
  private libPersistence: IndexeddbPersistence | null = null;
  private libProvider: WebsocketProvider | null = null;
  private bridge: LibraryBridge | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private again = false;
  private passTimer: ReturnType<typeof setTimeout> | undefined;
  /** Carnets ouverts (synchronisés en direct, exclus des passages en arrière-plan). */
  private open = new Set<ID>();
  private hooked = false;

  async start() {
    this.installDirtyHooks();
    setRemoteAssetFetcher((id) => this.fetchAsset(id));
    window.addEventListener('online', () => this.schedule(0));
    const account = syncState.account;
    if (account) await this.startAccount(account);
    clearInterval(this.timer);
    this.timer = setInterval(() => this.schedule(0), PASS_EVERY);
    this.schedule(500);
  }

  private async startAccount(account: AccountData) {
    syncState.status = 'connecting';
    // Session encore valide ?
    try {
      await apiJson(account.server, '/api/me', { auth: { token: account.token } });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        syncState.status = 'error';
        syncState.error = 'Session expirée : reconnectez-vous.';
        return;
      }
      // Hors ligne : on continue, tout se rattrapera.
    }
    const doc = new Y.Doc();
    this.libDoc = doc;
    this.libPersistence = new IndexeddbPersistence(`papier-library-${account.user.id}`, doc);
    await this.libPersistence.whenSynced;
    this.bridge = new LibraryBridge(doc);
    await this.bridge.start();
    // Un carnet modifié ailleurs : son contenu est à récupérer.
    this.bridge.onRemoteChange((kind, id) => {
      if (kind === 'notebooks') void this.markDirty(id).then(() => this.schedule(300));
      if (kind === 'templates') this.schedule(300);
    });
    const provider = new WebsocketProvider(wsBase(account.server), 'lib', doc, { params: { token: account.token } });
    registerRemoteOrigin(provider);
    provider.on('status', ({ status }: { status: string }) => {
      if (status === 'connected') {
        if (syncState.status !== 'syncing') syncState.status = 'synced';
        syncState.error = '';
        this.schedule(0);
      } else if (status === 'disconnected' && syncState.status !== 'error') syncState.status = navigator.onLine ? 'connecting' : 'offline';
    });
    this.libProvider = provider;
  }

  private stopAccount() {
    this.bridge?.stop();
    this.libProvider?.destroy();
    void this.libPersistence?.destroy();
    this.libDoc?.destroy();
    this.bridge = null;
    this.libProvider = null;
    this.libPersistence = null;
    this.libDoc = null;
  }

  async connectAccount(account: AccountData) {
    this.stopAccount();
    syncState.account = account;
    saveAccount(account);
    // Tous les carnets sont à envoyer (ou à vérifier) au moins une fois.
    await db.syncstate.clear();
    await this.startAccount(account);
    this.schedule(0);
  }

  async disconnectAccount() {
    const a = syncState.account;
    this.stopAccount();
    syncState.account = null;
    syncState.status = 'off';
    syncState.error = '';
    saveAccount(null);
    if (a) await apiFetch(a.server, '/api/auth/logout', { method: 'POST', auth: { token: a.token } }).catch(() => {});
  }

  /** Les modifications d'un carnet (locales ou annoncées par la bibliothèque) le marquent « à synchroniser ». */
  private installDirtyHooks() {
    if (this.hooked) return;
    this.hooked = true;
    // Hors de la transaction en cours (qui ne porte que sur la table des carnets).
    const later = (id: string) => () => Dexie.ignoreTransaction(() => void this.markDirty(id).then(() => this.schedule(1500)));
    db.notebooks.hook('creating', function (key) {
      this.onsuccess = later(String(key));
    });
    db.notebooks.hook('updating', function (mods, key) {
      if (!('updatedAt' in mods)) return;
      this.onsuccess = later(String(key));
    });
  }

  private async markDirty(id: ID) {
    const st = await db.syncstate.get(id);
    await db.syncstate.put({ id, syncedAt: st?.syncedAt ?? 0, dirtyAt: Date.now() });
  }

  schedule(delay: number) {
    clearTimeout(this.passTimer);
    this.passTimer = setTimeout(() => void this.pass(), delay);
  }

  /** Synchronise en arrière-plan tous les carnets qui en ont besoin. */
  private async pass() {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    try {
      const notebooks = (await db.notebooks.toArray()).filter((nb) => target(nb) && !this.open.has(nb.id));
      if (!notebooks.length && !syncState.account) return;
      const states = new Map((await db.syncstate.toArray()).map((s) => [s.id, s]));
      const todo = notebooks.filter((nb) => {
        const st = states.get(nb.id);
        return !st || st.dirtyAt >= st.syncedAt;
      });
      syncState.pending = todo.length;
      if (todo.length) syncState.status = 'syncing';
      let failed = false;
      for (const nb of todo) {
        try {
          await this.syncNotebook(nb);
        } catch (err) {
          failed = true;
          if (err instanceof ApiError && err.status === 0) break; // hors ligne : on réessaiera
        } finally {
          syncState.pending = Math.max(0, syncState.pending - 1);
        }
      }
      // Fichiers des modèles de page importés (bibliothèque).
      const account = syncState.account;
      if (account && !failed) {
        const templates = await db.templates.toArray();
        await syncAssets(account.server, { token: account.token }, templates.map((t) => t.assetId), true).catch(() => (failed = true));
      }
      const connected = !syncState.account || this.libProvider?.wsconnected;
      if (!failed && connected) {
        syncState.lastSync = Date.now();
        syncState.status = syncState.account || notebooks.length ? 'synced' : 'off';
      } else if (syncState.status !== 'error') syncState.status = navigator.onLine ? (failed ? 'error' : 'connecting') : 'offline';
      if (failed && navigator.onLine && syncState.status === 'error' && !syncState.error) syncState.error = 'Certains carnets n’ont pas pu être synchronisés.';
    } finally {
      this.running = false;
      if (this.again) {
        this.again = false;
        this.schedule(200);
      }
    }
  }

  /** Synchronise un carnet fermé (contenu, puis fichiers). */
  async syncNotebook(nb: NotebookRecord, signal?: AbortSignal) {
    const t = target(nb);
    if (!t) return;
    const startedAt = Date.now();
    try {
      await withNotebookDoc(nb.id, async (doc) => {
        await syncDoc(t.server, `nb-${nb.id}`, doc, t.auth, { push: t.canWrite, signal });
        await db.searchindex.put(buildIndex(nb.id, doc));
        await syncAssets(t.server, t.auth, assetIdsOf(doc), t.canWrite);
      });
      const st = await db.syncstate.get(nb.id);
      await db.syncstate.put({ id: nb.id, dirtyAt: st?.dirtyAt ?? 0, syncedAt: startedAt });
    } catch (err) {
      if (err instanceof ApiError && err.status !== 0) {
        const st = await db.syncstate.get(nb.id);
        // Accès retiré ou refusé : on n'insiste pas jusqu'à la prochaine modification.
        await db.syncstate.put({ id: nb.id, dirtyAt: st?.dirtyAt ?? 0, syncedAt: startedAt, error: err.message });
      }
      throw err;
    }
  }

  /** Ce carnet est-il synchronisé (compte ou lien de partage) ? */
  manages(nb: NotebookRecord): boolean {
    return !!target(nb);
  }

  /**
   * Avant d'ouvrir un carnet synchronisé : récupère son contenu (borné dans le temps).
   * Renvoie faux si le serveur n'a pas pu être joint.
   */
  async prepare(nb: NotebookRecord): Promise<boolean> {
    if (!target(nb)) return true;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 8000);
    try {
      await this.syncNotebook(nb, abort.signal);
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Carnet ouvert : synchronisation en temps réel et présence des autres (curseurs). */
  connectNotebook(nb: NotebookRecord, doc: Y.Doc): LiveConnection | null {
    const t = target(nb);
    if (!t) return null;
    const provider = new WebsocketProvider(wsBase(t.server), `nb-${nb.id}`, doc, {
      params: t.auth.token ? { token: t.auth.token } : { share: t.auth.share! },
    });
    registerRemoteOrigin(provider);
    this.open.add(nb.id);
    // Fichiers ajoutés ici ou par les autres : envoyés / téléchargés peu après.
    let assetTimer: ReturnType<typeof setTimeout> | undefined;
    const syncFiles = () => {
      clearTimeout(assetTimer);
      assetTimer = setTimeout(() => void syncAssets(t.server, t.auth, assetIdsOf(doc), t.canWrite).catch(() => {}), 1500);
    };
    doc.on('update', syncFiles);
    provider.on('sync', (synced: boolean) => synced && syncFiles());
    return {
      provider,
      destroy: () => {
        clearTimeout(assetTimer);
        doc.off('update', syncFiles);
        provider.destroy();
        this.open.delete(nb.id);
        void this.markDirty(nb.id).then(() => this.schedule(500));
      },
    };
  }

  /** Fichier manquant demandé par l'affichage : compte d'abord, puis liens de partage. */
  private async fetchAsset(id: ID): Promise<Blob | null> {
    const tries: { server: string; auth: Auth }[] = [];
    const a = syncState.account;
    if (a) tries.push({ server: a.server, auth: { token: a.token } });
    for (const nb of await db.notebooks.toArray()) if (nb.share) tries.push({ server: nb.share.server, auth: { share: nb.share.token } });
    for (const t of tries) {
      try {
        return await downloadAsset(t.server, t.auth, id);
      } catch {
        /* essai suivant */
      }
    }
    return null;
  }

  syncNow() {
    this.schedule(0);
  }
}

export interface LiveConnection {
  provider: WebsocketProvider;
  destroy(): void;
}

export const syncEngine = new SyncEngine();

/** Connexion ou création de compte ; la synchronisation démarre aussitôt. */
export async function signIn(serverUrl: string, email: string, password: string, mode: 'login' | 'register', name = '') {
  const server = normalizeServer(serverUrl);
  const path = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
  const body = mode === 'register' ? { email, password, name } : { email, password };
  const { token, user } = await apiJson<{ token: string; user: UserInfo }>(server, path, { json: body });
  await syncEngine.connectAccount({ server, token, user });
}

export async function signOut() {
  await syncEngine.disconnectAccount();
}
