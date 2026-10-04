import type { ID } from '../model/types';
import { db } from '../storage/db';
import { ensurePdfAnalyzed, pageString } from '../../pdf/analyze';
import { findRanges, makeSnippet, matchesAll, parseQuery, type Snippet } from './match';
import { ensureIndexes } from './notebookIndex';

export interface LibraryHit {
  notebookId: ID;
  title: string;
  pageIndex: number;
  snippet: Snippet;
  source: 'text' | 'pdf' | 'audio';
  /** Résultat dans une transcription (pageIndex vaut alors -1). */
  recordingId?: ID;
  recordingTitle?: string;
}

const MAX_PER_NOTEBOOK = 20;
const MAX_HITS = 200;

/**
 * Recherche dans le contenu de toute la bibliothèque : texte tapé et texte des PDF.
 * Une page correspond si elle contient tous les termes de la requête.
 */
export async function searchLibrary(query: string, onStatus?: (msg: string | null) => void): Promise<LibraryHit[]> {
  const terms = parseQuery(query);
  if (!terms.length) return [];
  const notebooks = await db.notebooks.toArray();
  await ensureIndexes(notebooks, (d, t) => onStatus?.(`Indexation des carnets… ${d}/${t}`));
  const indexes = await db.searchindex.toArray();
  const byId = new Map(notebooks.map((n) => [n.id, n]));

  // PDF importés avant l'étape 3 : analyse à la demande.
  const assets = new Set<ID>();
  for (const idx of indexes) for (const p of idx.pages) if (p.pdf) assets.add(p.pdf.assetId);
  let n = 0;
  for (const id of assets) {
    if (!(await db.pdfmeta.get(id))) {
      onStatus?.(`Analyse des PDF… ${++n}`);
      await ensurePdfAnalyzed(id);
    }
  }
  onStatus?.(null);

  const pdfCache = new Map<string, string>();
  const pdfText = async (assetId: ID, pageIndex: number) => {
    const key = `${assetId}#${pageIndex}`;
    if (!pdfCache.has(key)) pdfCache.set(key, pageString((await db.pdftext.get(key))?.items ?? []));
    return pdfCache.get(key)!;
  };

  const hits: LibraryHit[] = [];
  for (const idx of indexes) {
    const nb = byId.get(idx.notebookId);
    if (!nb) continue;
    let count = 0;
    for (let i = 0; i < idx.pages.length && count < MAX_PER_NOTEBOOK; i++) {
      const p = idx.pages[i];
      const typed = p.texts.join('\n');
      const pdf = p.pdf ? await pdfText(p.pdf.assetId, p.pdf.pageIndex) : '';
      if (!matchesAll(`${typed}\n${pdf}`, terms)) continue;
      const inTyped = findRanges(typed, terms)[0];
      const [text, range, source] = inTyped ? [typed, inTyped, 'text' as const] : [pdf, findRanges(pdf, terms)[0], 'pdf' as const];
      if (!range) continue;
      hits.push({ notebookId: nb.id, title: nb.title, pageIndex: i, snippet: makeSnippet(text, range), source });
      count++;
      if (hits.length >= MAX_HITS) return hits;
    }
    // Transcriptions : un résultat par enregistrement.
    for (const a of idx.audio ?? []) {
      const text = a.texts.join('\n');
      if (!matchesAll(text, terms)) continue;
      const range = findRanges(text, terms)[0];
      if (!range) continue;
      hits.push({ notebookId: nb.id, title: nb.title, pageIndex: -1, snippet: makeSnippet(text, range), source: 'audio', recordingId: a.recordingId, recordingTitle: a.title });
      if (hits.length >= MAX_HITS) return hits;
    }
  }
  return hits;
}
