import * as Y from 'yjs';
import { IndexeddbPersistence, clearDocument } from 'y-indexeddb';
import { LOCAL_ORIGIN, initNotebook, listPages, roots } from '../model/notebookDoc';
import type { ID, NotebookRecord } from '../model/types';
import { db } from './db';

export function docName(notebookId: ID) {
  return `papier-nb-${notebookId}`;
}

export interface OpenNotebook {
  id: ID;
  doc: Y.Doc;
  undo: Y.UndoManager;
  close(): Promise<void>;
}

/** Ouvre le document d'un carnet depuis IndexedDB (et le crée s'il est vide). */
export async function openNotebook(record: NotebookRecord): Promise<OpenNotebook> {
  const doc = new Y.Doc();
  const persistence = new IndexeddbPersistence(docName(record.id), doc);
  await persistence.whenSynced;

  initNotebook(doc, record.title, {
    width: record.paper.width,
    height: record.paper.height,
    template: record.template,
  });

  const { pageOrder, pages } = roots(doc);
  const undo = new Y.UndoManager([pageOrder, pages], {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    // Les étapes d'annulation sont délimitées explicitement par Editor.beginAction().
    captureTimeout: 10 * 60 * 1000,
  });

  // Tient à jour l'index de la bibliothèque (date de modification, nombre de pages).
  let timer: ReturnType<typeof setTimeout> | undefined;
  const syncMeta = () => {
    timer = undefined;
    void db.notebooks.update(record.id, {
      updatedAt: Date.now(),
      pageCount: pageOrder.length,
    });
  };
  const onUpdate = (_u: Uint8Array, origin: unknown) => {
    if (origin === persistence) return;
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

/** Crée et enregistre le document initial d'un nouveau carnet. */
export async function createNotebookDoc(record: NotebookRecord, from?: ID) {
  const doc = new Y.Doc();
  const persistence = new IndexeddbPersistence(docName(record.id), doc);
  await persistence.whenSynced;
  if (from) {
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

export async function deleteNotebookDoc(id: ID) {
  await clearDocument(docName(id));
}
