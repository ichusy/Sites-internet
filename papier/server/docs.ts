import * as Y from 'yjs';
import { Awareness, removeAwarenessStates } from 'y-protocols/awareness';
import type { Store } from './db.ts';
import { SNAPSHOT_EVERY, snapshotsToPrune } from './snapshots.ts';

/** Au-delà de ce nombre de mises à jour stockées, elles sont fusionnées en une seule. */
const COMPACT_AFTER = 300;
/** Un document sans connexion reste en mémoire ce temps-là avant d'être déchargé. */
const IDLE_MS = 60_000;

export interface Connection {
  /** Envoie un message binaire (protocole y-websocket). */
  send(data: Uint8Array): void;
  /** Identifiants d'awareness contrôlés par cette connexion (curseurs à effacer à la fermeture). */
  awarenessIds: Set<number>;
}

export interface LiveDoc {
  id: string;
  doc: Y.Doc;
  awareness: Awareness;
  conns: Set<Connection>;
  idleTimer?: ReturnType<typeof setTimeout>;
}

/**
 * Documents Yjs côté serveur : chargés depuis SQLite à la demande, gardés en mémoire tant
 * qu'ils sont utilisés, chaque mise à jour écrite aussitôt. Une version datée (snapshot) est
 * enregistrée au plus une fois par heure pour l'historique des carnets.
 */
export class DocManager {
  private live = new Map<string, LiveDoc>();
  private compactTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private store: Store;
  private now: () => number;
  constructor(store: Store, now: () => number = Date.now) {
    this.store = store;
    this.now = now;
  }

  /** Charge (ou renvoie) un document. Le propriétaire doit déjà être enregistré dans `docs`. */
  get(id: string): LiveDoc {
    let entry = this.live.get(id);
    if (entry) {
      // Utilisé à nouveau : le délai avant déchargement repart de zéro.
      this.scheduleRelease(entry);
      return entry;
    }
    const doc = new Y.Doc({ gc: true });
    const updates = this.store.updates(id);
    if (updates.length) doc.transact(() => updates.forEach((u) => Y.applyUpdate(doc, u)), 'load');
    const awareness = new Awareness(doc);
    awareness.setLocalState(null);
    entry = { id, doc, awareness, conns: new Set() };
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === 'load') return;
      this.persist(id, doc, update);
    });
    this.live.set(id, entry);
    this.scheduleRelease(entry);
    return entry;
  }

  /** Applique une mise à jour venue d'un client (synchronisation HTTP ou WebSocket). */
  apply(id: string, update: Uint8Array, origin: unknown) {
    Y.applyUpdate(this.get(id).doc, update, origin);
  }

  stateVector(id: string): Uint8Array {
    return Y.encodeStateVector(this.get(id).doc);
  }

  /** Ce qui manque au client, d'après son vecteur d'état. */
  diff(id: string, clientStateVector?: Uint8Array): Uint8Array {
    return Y.encodeStateAsUpdate(this.get(id).doc, clientStateVector);
  }

  attach(entry: LiveDoc, conn: Connection) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = undefined;
    entry.conns.add(conn);
  }

  detach(entry: LiveDoc, conn: Connection) {
    entry.conns.delete(conn);
    if (conn.awarenessIds.size) removeAwarenessStates(entry.awareness, [...conn.awarenessIds], null);
    this.scheduleRelease(entry);
  }

  private scheduleRelease(entry: LiveDoc) {
    if (entry.conns.size) return;
    clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => {
      if (entry.conns.size) return;
      this.flushCompaction(entry.id);
      this.live.delete(entry.id);
      entry.awareness.destroy();
      entry.doc.destroy();
    }, IDLE_MS);
    entry.idleTimer.unref?.();
  }

  private persist(id: string, doc: Y.Doc, update: Uint8Array) {
    const now = this.now();
    this.store.appendUpdate(id, update);
    this.store.touchDoc(id, now);
    // Historique : seulement pour les carnets (pas pour la bibliothèque).
    if (id.startsWith('nb:') && now - this.store.lastSnapshotAt(id) >= SNAPSHOT_EVERY) {
      this.store.addSnapshot(id, now, Y.encodeStateAsUpdate(doc));
      const times = this.store.snapshots(id).map((s) => s.created_at);
      const prune = snapshotsToPrune(times, now);
      if (prune.length) this.store.deleteSnapshots(id, prune);
    }
    if (!this.compactTimers.has(id) && this.store.updateCount(id) > COMPACT_AFTER) {
      const t = setTimeout(() => this.flushCompaction(id), 2000);
      t.unref?.();
      this.compactTimers.set(id, t);
    }
  }

  private flushCompaction(id: string) {
    clearTimeout(this.compactTimers.get(id));
    this.compactTimers.delete(id);
    const entry = this.live.get(id);
    if (!entry || this.store.updateCount(id) <= COMPACT_AFTER) return;
    this.store.replaceUpdates(id, Y.encodeStateAsUpdate(entry.doc));
  }

  /** Arrêt du serveur : tout est déjà écrit, on compacte simplement ce qui peut l'être. */
  close() {
    for (const id of [...this.live.keys()]) this.flushCompaction(id);
    for (const e of this.live.values()) {
      clearTimeout(e.idleTimer);
      e.awareness.destroy();
      e.doc.destroy();
    }
    this.live.clear();
  }
}
