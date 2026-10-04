import * as Y from 'yjs';
import { IndexeddbPersistence, clearDocument } from 'y-indexeddb';
import { LOCAL_ORIGIN, SCHEMA_VERSION, initNotebook, insertPage, isRemoteOrigin, listPages, roots } from '../model/notebookDoc';
import { newId } from '../model/ids';
import type { ID, NotebookRecord, PageData } from '../model/types';
import { db } from './db';
import { buildIndex } from '../search/notebookIndex';

export function docName(notebookId: ID) {
  return `papier-nb-${notebookId}`;
}

export interface OpenNotebook {
  id: ID;
  doc: Y.Doc;
  undo: Y.UndoManager;
  close(): Promise<void>;
}

/**
 * Ouvre le document d'un carnet depuis IndexedDB. S'il est vide, une première page est créée,
 * sauf avec `init: false` (carnet synchronisé pas encore téléchargé : on ne crée rien qui
 * viendrait s'ajouter aux pages du serveur).
 */
export async function openNotebook(record: NotebookRecord, opts: { init?: boolean } = {}): Promise<OpenNotebook> {
  const doc = new Y.Doc();
  const persistence = new IndexeddbPersistence(docName(record.id), doc);
  await persistence.whenSynced;

  if (opts.init !== false) {
    initNotebook(doc, record.title, {
      width: record.paper.width,
      height: record.paper.height,
      template: record.template,
    });
  }

  const { pageOrder, pages } = roots(doc);
  const undo = new Y.UndoManager([pageOrder, pages], {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    // Les étapes d'annulation sont délimitées explicitement par Editor.beginAction().
    captureTimeout: 10 * 60 * 1000,
  });

  // Tient à jour l'index de la bibliothèque (date de modification, nombre de pages).
  let timer: ReturnType<typeof setTimeout> | undefined;
  let localChange = false;
  const syncMeta = () => {
    timer = undefined;
    // Date de modification : seulement pour les modifications faites sur cet appareil
    // (l'autre appareil a déjà mis à jour la sienne, reçue par la bibliothèque).
    if (localChange) {
      void db.notebooks.update(record.id, {
        updatedAt: Date.now(),
        pageCount: pageOrder.length,
      });
    }
    localChange = false;
    // Index de recherche (texte tapé, pages de PDF) tenu à jour au fil de l'eau.
    void db.searchindex.put(buildIndex(record.id, doc));
  };
  const onUpdate = (_u: Uint8Array, origin: unknown) => {
    if (origin === persistence) return;
    if (!isRemoteOrigin(origin)) localChange = true;
    clearTimeout(timer);
    timer = setTimeout(syncMeta, 800);
  };
  doc.on('update', onUpdate);

  await db.notebooks.update(record.id, { openedAt: Date.now() });

  return {
    id: record.id,
    doc,
    undo,
    async close() {
      if (timer) {
        clearTimeout(timer);
        syncMeta();
      }
      doc.off('update', onUpdate);
      undo.destroy();
      await persistence.destroy();
      doc.destroy();
    },
  };
}

export interface NewDocOptions {
  /** Copier le contenu d'un autre carnet. */
  from?: ID;
  /** Pages initiales (import de PDF / d'images). */
  pages?: Omit<PageData, 'id'>[];
  /** État Yjs complet (restauration d'archive). */
  update?: Uint8Array;
}

/** Crée et enregistre le document initial d'un nouveau carnet. Renvoie le nombre de pages. */
export async function createNotebookDoc(record: NotebookRecord, opts: NewDocOptions = {}) {
  const { from } = opts;
  const doc = new Y.Doc();
  const persistence = new IndexeddbPersistence(docName(record.id), doc);
  await persistence.whenSynced;
  if (opts.update) {
    Y.applyUpdate(doc, opts.update);
    roots(doc).meta.set('title', record.title);
  } else if (opts.pages?.length) {
    doc.transact(() => {
      const { meta } = roots(doc);
      meta.set('schemaVersion', SCHEMA_VERSION);
      meta.set('title', record.title);
      opts.pages!.forEach((p, i) => insertPage(doc, { ...p, id: newId() }, i));
    });
  } else if (from) {
    const src = new Y.Doc();
    const srcPersistence = new IndexeddbPersistence(docName(from), src);
    await srcPersistence.whenSynced;
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(src));
    await srcPersistence.destroy();
    src.destroy();
    roots(doc).meta.set('title', record.title);
  } else {
    initNotebook(doc, record.title, {
      width: record.paper.width,
      height: record.paper.height,
      template: record.template,
    });
  }
  const pageCount = listPages(doc).length;
  await persistence.destroy();
  doc.destroy();
  return pageCount;
}

/**
 * Ouvre le document d'un carnet le temps d'une opération (synchronisation en arrière-plan) :
 * les modifications faites par `fn` sont enregistrées dans IndexedDB.
 */
export async function withNotebookDoc<T>(id: ID, fn: (doc: Y.Doc) => Promise<T>): Promise<T> {
  const doc = new Y.Doc();
  const persistence = new IndexeddbPersistence(docName(id), doc);
  await persistence.whenSynced;
  try {
    return await fn(doc);
  } finally {
    await persistence.destroy();
    doc.destroy();
  }
}

/**
 * Charge une copie en lecture du document d'un carnet (export depuis la bibliothèque).
 * L'appelant doit appeler `doc.destroy()` une fois terminé.
 */
export async function loadNotebookDoc(id: ID): Promise<Y.Doc> {
  const doc = new Y.Doc();
  const persistence = new IndexeddbPersistence(docName(id), doc);
  await persistence.whenSynced;
  await persistence.destroy();
  return doc;
}

export async function deleteNotebookDoc(id: ID) {
  await clearDocument(docName(id));
}
