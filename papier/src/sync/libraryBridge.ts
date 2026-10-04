import Dexie, { type Table } from 'dexie';
import * as Y from 'yjs';
import type { FolderRecord, NotebookRecord, TemplateRecord } from '../core/model/types';
import { db } from '../core/storage/db';
import { deleteNotebookDoc } from '../core/storage/notebookStore';

/**
 * Pont entre la bibliothèque locale (tables Dexie, que l'interface lit) et la bibliothèque du
 * compte (un Y.Doc synchronisé : cartes `folders`, `notebooks`, `templates`).
 *
 *  - Écriture locale (création, renommage, déplacement, suppression…) : les « hooks » Dexie la
 *    recopient dans le Y.Doc, qui la transmet au serveur.
 *  - Modification venue d'un autre appareil : recopiée dans Dexie ; l'interface se met à jour.
 *
 * Chaque recopie compare d'abord les valeurs : une modification ne fait jamais l'aller-retour.
 * Restent propres à l'appareil : `openedAt` (dernière ouverture) et les carnets reçus par lien.
 */

type Kind = 'folders' | 'notebooks' | 'templates';
type Rec = FolderRecord | NotebookRecord | TemplateRecord;

const BRIDGE_ORIGIN = { name: 'library-bridge' };

const tables: Record<Kind, Table<Rec, string>> = {
  folders: db.folders as unknown as Table<Rec, string>,
  notebooks: db.notebooks as unknown as Table<Rec, string>,
  templates: db.templates as unknown as Table<Rec, string>,
};

/** Valeur synchronisée d'un enregistrement, ou null s'il ne se synchronise pas. */
function shared(kind: Kind, rec: Rec): Record<string, unknown> | null {
  if (kind !== 'notebooks') return { ...rec };
  const nb = rec as NotebookRecord;
  if (nb.share) return null;
  const { openedAt: _openedAt, ...rest } = nb;
  return rest;
}

/** Comparaison indépendante de l'ordre des clés. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

function applyMods<T extends object>(obj: T, mods: Record<string, unknown>): T {
  const next = structuredClone(obj) as Record<string, unknown>;
  for (const [path, value] of Object.entries(mods)) {
    const keys = path.split('.');
    let target = next;
    for (const k of keys.slice(0, -1)) target = (target[k] ??= {}) as Record<string, unknown>;
    const last = keys[keys.length - 1];
    if (value === undefined) delete target[last];
    else target[last] = value;
  }
  return next as T;
}

let active: LibraryBridge | null = null;
let hooksInstalled = false;

function installHooks() {
  if (hooksInstalled) return;
  hooksInstalled = true;
  for (const kind of Object.keys(tables) as Kind[]) {
    const table = tables[kind];
    table.hook('creating', function (key, obj) {
      const bridge = active;
      if (!bridge) return;
      const id = String(key ?? (obj as Rec).id);
      this.onsuccess = () => Dexie.ignoreTransaction(() => bridge.pushLocal(kind, id, obj as Rec));
    });
    table.hook('updating', function (mods, key, obj) {
      const bridge = active;
      if (!bridge) return;
      const next = applyMods(obj as Rec, mods as Record<string, unknown>);
      this.onsuccess = () => Dexie.ignoreTransaction(() => bridge.pushLocal(kind, String(key), next));
    });
    table.hook('deleting', function (key, obj) {
      const bridge = active;
      if (!bridge) return;
      this.onsuccess = () => Dexie.ignoreTransaction(() => bridge.pushDelete(kind, String(key), obj as Rec));
    });
  }
}

export class LibraryBridge {
  private maps: Record<Kind, Y.Map<Record<string, unknown>>>;
  private onChange = new Set<(kind: Kind, id: string) => void>();

  constructor(readonly doc: Y.Doc) {
    this.maps = {
      folders: doc.getMap('folders'),
      notebooks: doc.getMap('notebooks'),
      templates: doc.getMap('templates'),
    };
  }

  /** Démarre : fusionne local et distant, puis suit les deux côtés. */
  async start() {
    installHooks();
    await this.reconcile();
    active = this;
    for (const kind of Object.keys(this.maps) as Kind[]) {
      this.maps[kind].observe((ev, tr) => {
        if (tr.origin === BRIDGE_ORIGIN) return;
        for (const id of ev.keysChanged) void this.applyRemote(kind, id);
      });
    }
  }

  stop() {
    if (active === this) active = null;
  }

  /** Notifié quand un carnet change côté distant (pour synchroniser son contenu). */
  onRemoteChange(fn: (kind: Kind, id: string) => void) {
    this.onChange.add(fn);
    return () => this.onChange.delete(fn);
  }

  /**
   * Fusion initiale : ce qui n'existe que localement part vers le compte (carnets créés avant la
   * connexion), ce qui n'existe que sur le compte arrive ici, et à valeur différente le local l'emporte
   * (le Y.Doc local contient déjà tout ce qui a été reçu lors des sessions précédentes).
   */
  private async reconcile() {
    for (const kind of Object.keys(this.maps) as Kind[]) {
      const map = this.maps[kind];
      const local = await tables[kind].toArray();
      const localIds = new Set(local.map((r) => r.id));
      this.doc.transact(() => {
        for (const rec of local) {
          const v = shared(kind, rec);
          if (v && stable(map.get(rec.id)) !== stable(v)) map.set(rec.id, v);
        }
      }, BRIDGE_ORIGIN);
      for (const id of map.keys()) if (!localIds.has(id)) await this.applyRemote(kind, id);
    }
  }

  pushLocal(kind: Kind, id: string, rec: Rec) {
    const v = shared(kind, rec);
    if (!v) return;
    const map = this.maps[kind];
    if (stable(map.get(id)) === stable(v)) return;
    this.doc.transact(() => map.set(id, v), BRIDGE_ORIGIN);
  }

  pushDelete(kind: Kind, id: string, rec: Rec | undefined) {
    if (rec && kind === 'notebooks' && (rec as NotebookRecord).share) return;
    const map = this.maps[kind];
    if (map.has(id)) this.doc.transact(() => map.delete(id), BRIDGE_ORIGIN);
  }

  private async applyRemote(kind: Kind, id: string) {
    const table = tables[kind];
    const value = this.maps[kind].get(id);
    const local = await table.get(id);
    if (value === undefined) {
      if (!local || (kind === 'notebooks' && (local as NotebookRecord).share)) return;
      await table.delete(id);
      if (kind === 'notebooks') {
        await deleteNotebookDoc(id);
        await db.syncstate.delete(id);
        await db.searchindex.delete(id);
      }
    } else {
      if (local && stable(shared(kind, local)) === stable(value)) return;
      const next = (kind === 'notebooks' ? { ...value, openedAt: (local as NotebookRecord | undefined)?.openedAt ?? 0 } : value) as unknown as Rec;
      await table.put(next);
    }
    for (const fn of this.onChange) fn(kind, id);
  }
}
