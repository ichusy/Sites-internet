import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import * as Y from 'yjs';
import { newId } from '../core/model/ids';
import { docToJson, jsonToDoc, type NotebookJson } from '../core/model/serialize';
import { listPages, pageElements, roots } from '../core/model/notebookDoc';
import type { AssetRecord, FolderRecord, ID, NotebookRecord, TemplateRecord } from '../core/model/types';
import { db } from '../core/storage/db';
import { createNotebookDoc, loadNotebookDoc } from '../core/storage/notebookStore';

/**
 * Archive .papier = fichier zip :
 *   manifest.json            { format: "papier-archive", version, exportedAt }
 *   library.json             { folders, notebooks, templates } (modèles importés : sauvegarde complète)
 *   notebooks/<id>.json      contenu lisible (NotebookJson, voir FORMAT.md)
 *   notebooks/<id>.ydoc      état Yjs complet (restauration sans perte)
 *   assets/<sha256>.<ext>    fichiers importés (PDF, images)
 *   assets.json              [{ id, mime, size, file }]
 */
export const ARCHIVE_FORMAT = 'papier-archive';
export const ARCHIVE_VERSION = 1;

const EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
};

/** Fichiers utilisés par un carnet : fonds de page, modèles importés, images et autocollants. */
function assetIdsOf(doc: Y.Doc): Set<ID> {
  const ids = new Set<ID>();
  for (const p of listPages(doc)) {
    if (p.background) ids.add(p.background.assetId);
    if (p.template.source) ids.add(p.template.source.assetId);
    for (const el of pageElements(doc, p.id)?.values() ?? []) if (el.type === 'image') ids.add(el.assetId);
  }
  return ids;
}

/** Construit l'archive des carnets indiqués (et de tous les dossiers si `includeFolders`). */
export async function exportArchive(notebookIds: ID[], includeFolders: boolean): Promise<Blob> {
  const files: Zippable = {};
  const notebooks = (await db.notebooks.bulkGet(notebookIds)).filter((n): n is NotebookRecord => !!n);
  const folders: FolderRecord[] = includeFolders ? await db.folders.toArray() : [];
  const templates: TemplateRecord[] = includeFolders ? await db.templates.toArray() : [];
  const assetIds = new Set<ID>(templates.map((t) => t.assetId));

  for (const nb of notebooks) {
    const doc = await loadNotebookDoc(nb.id);
    try {
      files[`notebooks/${nb.id}.json`] = strToU8(JSON.stringify(docToJson(doc)));
      files[`notebooks/${nb.id}.ydoc`] = Y.encodeStateAsUpdate(doc);
      for (const id of assetIdsOf(doc)) assetIds.add(id);
    } finally {
      doc.destroy();
    }
  }

  const assetIndex: { id: ID; mime: string; size: number; file: string }[] = [];
  for (const id of assetIds) {
    const rec = await db.assets.get(id);
    if (!rec) continue;
    const file = `assets/${id}.${EXT[rec.mime] ?? 'bin'}`;
    // Fichiers déjà compressés : stockés sans recompression.
    files[file] = [new Uint8Array(await rec.blob.arrayBuffer()), { level: 0 }];
    assetIndex.push({ id, mime: rec.mime, size: rec.size, file });
  }

  files['manifest.json'] = strToU8(JSON.stringify({ format: ARCHIVE_FORMAT, version: ARCHIVE_VERSION, exportedAt: new Date().toISOString() }, null, 2));
  files['library.json'] = strToU8(JSON.stringify({ folders, notebooks, templates }, null, 2));
  files['assets.json'] = strToU8(JSON.stringify(assetIndex, null, 2));

  const zip = zipSync(files, { level: 6 });
  return new Blob([zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}

export interface ImportResult {
  notebooks: NotebookRecord[];
  folders: number;
}

/**
 * Importe une archive .papier. Tout est importé comme copie (nouveaux identifiants) :
 * rien d'existant n'est écrasé. Les dossiers de l'archive sont recréés sous `targetFolder`.
 */
export async function importArchive(data: Blob, targetFolder: ID | null): Promise<ImportResult> {
  const files = unzipSync(new Uint8Array(await data.arrayBuffer()));
  const text = (name: string) => (files[name] ? strFromU8(files[name]) : null);
  const manifest = JSON.parse(text('manifest.json') ?? 'null');
  if (manifest?.format !== ARCHIVE_FORMAT) throw new Error('Ce fichier n’est pas une archive Papier.');
  if (manifest.version > ARCHIVE_VERSION) throw new Error('Archive créée par une version plus récente de Papier.');

  const library = JSON.parse(text('library.json') ?? '{"folders":[],"notebooks":[]}') as {
    folders: FolderRecord[];
    notebooks: NotebookRecord[];
    templates?: TemplateRecord[];
  };
  const assetIndex = JSON.parse(text('assets.json') ?? '[]') as { id: ID; mime: string; size: number; file: string }[];

  // Fichiers d'abord : les carnets y font référence.
  for (const a of assetIndex) {
    const bytes = files[a.file];
    if (!bytes || (await db.assets.get(a.id))) continue;
    const rec: AssetRecord = { id: a.id, mime: a.mime, size: bytes.byteLength, blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: a.mime }), createdAt: Date.now() };
    await db.assets.put(rec);
  }

  // Modèles importés (ceux déjà présents sont conservés tels quels).
  for (const t of library.templates ?? []) if (!(await db.templates.get(t.id))) await db.templates.add(t);

  // Dossiers, en recréant l'arborescence avec de nouveaux identifiants.
  const folderMap = new Map<ID, ID>();
  const pending = [...library.folders];
  const now = Date.now();
  while (pending.length) {
    const idx = pending.findIndex((f) => !f.parentId || folderMap.has(f.parentId) || !library.folders.some((o) => o.id === f.parentId));
    const [f] = pending.splice(idx < 0 ? 0 : idx, 1);
    const id = newId();
    folderMap.set(f.id, id);
    const parentId = f.parentId && folderMap.has(f.parentId) ? folderMap.get(f.parentId)! : targetFolder;
    await db.folders.add({ ...f, id, parentId, updatedAt: now });
  }

  const imported: NotebookRecord[] = [];
  for (const nb of library.notebooks) {
    const record: NotebookRecord = {
      ...nb,
      id: newId(),
      folderId: nb.folderId && folderMap.has(nb.folderId) ? folderMap.get(nb.folderId)! : targetFolder,
      openedAt: 0,
    };
    const ydoc = files[`notebooks/${nb.id}.ydoc`];
    let update: Uint8Array | undefined = ydoc;
    if (!update) {
      // Repli sur la forme JSON (archive produite par un autre outil).
      const json = text(`notebooks/${nb.id}.json`);
      if (!json) continue;
      const doc = jsonToDoc(JSON.parse(json) as NotebookJson);
      update = Y.encodeStateAsUpdate(doc);
      doc.destroy();
    }
    record.pageCount = await createNotebookDoc(record, { update });
    await db.notebooks.add(record);
    imported.push(record);
  }
  return { notebooks: imported, folders: folderMap.size };
}

/** Titre stocké dans un document (utilisé pour nommer les exports). */
export function docTitle(doc: Y.Doc) {
  return (roots(doc).meta.get('title') as string) || 'Carnet';
}
