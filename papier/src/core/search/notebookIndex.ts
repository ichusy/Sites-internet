import type * as Y from 'yjs';
import { listPages, pageElements } from '../model/notebookDoc';
import type { ID, NotebookIndexRecord, NotebookRecord } from '../model/types';
import { db } from '../storage/db';
import { loadNotebookDoc } from '../storage/notebookStore';

/** Extrait le texte tapé de chaque page (dans l'ordre z) et la page de PDF éventuelle. */
export function buildIndex(notebookId: ID, doc: Y.Doc): NotebookIndexRecord {
  return {
    notebookId,
    updatedAt: Date.now(),
    pages: listPages(doc).map((p) => {
      const texts = [...(pageElements(doc, p.id)?.values() ?? [])]
        .filter((el) => el.type === 'text')
        .sort((a, b) => a.z - b.z)
        .map((el) => (el.type === 'text' ? el.text : ''));
      const entry: NotebookIndexRecord['pages'][number] = { pageId: p.id, texts };
      if (p.background?.kind === 'pdf') entry.pdf = { assetId: p.background.assetId, pageIndex: p.background.pageIndex };
      return entry;
    }),
  };
}

/** Recalcule les index absents ou plus anciens que la dernière modification du carnet. */
export async function ensureIndexes(notebooks: NotebookRecord[], onProgress?: (done: number, total: number) => void) {
  const existing = new Map((await db.searchindex.toArray()).map((r) => [r.notebookId, r]));
  const stale = notebooks.filter((nb) => {
    const idx = existing.get(nb.id);
    return !idx || idx.updatedAt + 2000 < nb.updatedAt;
  });
  let done = 0;
  for (const nb of stale) {
    const doc = await loadNotebookDoc(nb.id);
    try {
      await db.searchindex.put(buildIndex(nb.id, doc));
    } finally {
      doc.destroy();
    }
    onProgress?.(++done, stale.length);
  }
}
