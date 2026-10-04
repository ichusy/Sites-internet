import type * as Y from 'yjs';
import { COVER_COLORS } from '../core/model/paper';
import type { ID, NotebookRecord } from '../core/model/types';
import { db } from '../core/storage/db';
import { loadNotebookDoc } from '../core/storage/notebookStore';
import { docTitle, exportArchive, importArchive } from '../io/archive';
import { pickFiles, safeFileName, saveFile } from '../io/files';
import { exportPdf } from '../pdf/exportPdf';
import { importAsNotebook, isImage, isPdf, pagesFromFiles, type ImportedPage } from '../pdf/importFiles';
import { showToast, withBusy } from './common/toast.svelte';

export const IMPORT_ACCEPT = '.pdf,application/pdf,image/*,.papier,application/zip';

function isArchive(f: File) {
  return /\.papier$/i.test(f.name) || f.type === 'application/zip';
}

function randomCover() {
  return { color: COVER_COLORS[Math.floor(Math.random() * 8)], pattern: 'plain' as const };
}

/** Exporte un carnet en PDF (depuis un document ouvert ou depuis la bibliothèque). */
export async function exportNotebookPdf(source: Y.Doc | ID, annotations: boolean) {
  await withBusy('Création du PDF…', async () => {
    const doc = typeof source === 'string' ? await loadNotebookDoc(source) : source;
    try {
      const bytes = await exportPdf(doc, { annotations });
      const title = docTitle(doc) + (annotations ? '' : ' (sans annotations)');
      await saveFile(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), safeFileName(title, 'pdf'));
    } finally {
      if (typeof source === 'string') doc.destroy();
    }
  }, () => 'PDF exporté.');
}

export async function exportNotebookArchive(nb: NotebookRecord) {
  await withBusy('Préparation de la sauvegarde…', async () => {
    const blob = await exportArchive([nb.id], false);
    await saveFile(blob, safeFileName(nb.title, 'papier'));
  }, () => 'Carnet sauvegardé.');
}

export async function backupLibrary() {
  await withBusy('Sauvegarde de la bibliothèque…', async () => {
    const ids = (await db.notebooks.toCollection().primaryKeys()) as ID[];
    const blob = await exportArchive(ids, true);
    const date = new Date().toISOString().slice(0, 10);
    await saveFile(blob, `Bibliothèque Papier ${date}.papier`);
  }, () => 'Bibliothèque sauvegardée.');
}

/**
 * Importe des fichiers dans la bibliothèque : archives .papier restaurées,
 * PDF et images regroupés en un nouveau carnet. Renvoie le carnet créé s'il n'y en a qu'un.
 */
export async function importIntoLibrary(files: File[], folderId: ID | null): Promise<NotebookRecord | null> {
  if (!files.length) return null;
  const archives = files.filter(isArchive);
  const docs = files.filter((f) => !isArchive(f) && (isPdf(f) || isImage(f)));
  const ignored = files.length - archives.length - docs.length;
  const created: NotebookRecord[] = [];
  await withBusy('Import en cours…', async () => {
    for (const a of archives) created.push(...(await importArchive(a, folderId)).notebooks);
    if (docs.length) {
      const nb = await importAsNotebook(docs, folderId, randomCover());
      if (nb) created.push(nb);
    }
  }, () => (created.length ? `${created.length} carnet${created.length > 1 ? 's' : ''} importé${created.length > 1 ? 's' : ''}.` : null));
  if (ignored) showToast(`${ignored} fichier${ignored > 1 ? 's' : ''} ignoré${ignored > 1 ? 's' : ''} (format non pris en charge).`, 'error');
  return created.length === 1 ? created[0] : null;
}

/** Sélecteur de fichiers pour la bibliothèque. */
export async function pickAndImport(folderId: ID | null) {
  return importIntoLibrary(await pickFiles(IMPORT_ACCEPT), folderId);
}

/** Convertit des PDF/images en pages à insérer dans le carnet ouvert. */
export async function pagesForInsertion(files: File[]): Promise<ImportedPage[]> {
  const usable = files.filter((f) => isPdf(f) || isImage(f));
  if (!usable.length) {
    if (files.length) showToast('Seuls les PDF et les images peuvent être insérés.', 'error');
    return [];
  }
  return (await withBusy('Import des pages…', () => pagesFromFiles(usable))) ?? [];
}
