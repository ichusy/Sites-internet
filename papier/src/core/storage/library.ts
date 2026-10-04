import { db } from './db';
import { newId } from '../model/ids';
import { createNotebookDoc, deleteNotebookDoc } from './notebookStore';
import type { CoverSpec, FolderRecord, ID, NotebookKind, NotebookRecord, PageData, TemplateRef } from '../model/types';

// ── Dossiers ─────────────────────────────────────────────

export async function createFolder(name: string, parentId: ID | null): Promise<FolderRecord> {
  const now = Date.now();
  const folder: FolderRecord = { id: newId(), parentId, name: name.trim() || 'Sans titre', createdAt: now, updatedAt: now };
  await db.folders.add(folder);
  return folder;
}

export async function renameFolder(id: ID, name: string) {
  await db.folders.update(id, { name: name.trim() || 'Sans titre', updatedAt: Date.now() });
}

/** Vrai si `candidate` est `folderId` ou l'un de ses descendants. */
export async function isDescendant(candidate: ID | null, folderId: ID): Promise<boolean> {
  const all = await db.folders.toArray();
  const byId = new Map(all.map((f) => [f.id, f]));
  let cur = candidate;
  while (cur) {
    if (cur === folderId) return true;
    cur = byId.get(cur)?.parentId ?? null;
  }
  return false;
}

export async function moveFolder(id: ID, parentId: ID | null) {
  if (parentId && (await isDescendant(parentId, id))) return;
  await db.folders.update(id, { parentId, updatedAt: Date.now() });
}

/** Supprime un dossier ; son contenu (sous-dossiers et carnets) remonte dans le dossier parent. */
export async function deleteFolder(id: ID) {
  await db.transaction('rw', db.folders, db.notebooks, async () => {
    const folder = await db.folders.get(id);
    if (!folder) return;
    await db.folders.where('parentId').equals(id).modify({ parentId: folder.parentId });
    await db.notebooks.where('folderId').equals(id).modify({ folderId: folder.parentId });
    await db.folders.delete(id);
  });
}

// ── Carnets ──────────────────────────────────────────────

export interface NewNotebookOptions {
  title: string;
  folderId: ID | null;
  cover: CoverSpec;
  paper: { width: number; height: number };
  template: TemplateRef;
  /** Pages initiales (import) ; sinon une page vierge au format `paper`. */
  pages?: Omit<PageData, 'id'>[];
  /** 'canvas' : tableau blanc infini (une seule page sans bords). */
  kind?: NotebookKind;
}

export async function createNotebook(opts: NewNotebookOptions): Promise<NotebookRecord> {
  const now = Date.now();
  const record: NotebookRecord = {
    id: newId(),
    folderId: opts.folderId,
    title: opts.title.trim() || 'Sans titre',
    kind: opts.kind ?? 'paged',
    cover: opts.cover,
    favorite: false,
    tags: [],
    pageCount: 1,
    paper: opts.paper,
    template: opts.template,
    createdAt: now,
    updatedAt: now,
    openedAt: 0,
  };
  const board: Omit<PageData, 'id'>[] = [{ width: 1000, height: 1000, template: { kind: 'dots', spacing: 20 }, infinite: true }];
  record.pageCount = await createNotebookDoc(record, { pages: record.kind === 'canvas' ? board : opts.pages });
  await db.notebooks.add(record);
  return record;
}

export async function updateNotebook(id: ID, patch: Partial<Omit<NotebookRecord, 'id'>>) {
  await db.notebooks.update(id, { ...patch, updatedAt: Date.now() });
}

export async function toggleFavorite(id: ID) {
  const nb = await db.notebooks.get(id);
  if (nb) await db.notebooks.update(id, { favorite: !nb.favorite });
}

export async function duplicateNotebook(id: ID): Promise<NotebookRecord | null> {
  const src = await db.notebooks.get(id);
  if (!src) return null;
  const now = Date.now();
  const { share: _share, ...base } = src;
  const record: NotebookRecord = {
    ...base,
    id: newId(),
    title: `${src.title} (copie)`,
    favorite: false,
    createdAt: now,
    updatedAt: now,
    openedAt: 0,
  };
  record.pageCount = await createNotebookDoc(record, { from: src.id });
  await db.notebooks.add(record);
  return record;
}

/** Nouveau carnet à partir d'un état Yjs complet (version restaurée de l'historique). */
export async function createNotebookFromState(src: NotebookRecord, update: Uint8Array, title: string): Promise<NotebookRecord> {
  const now = Date.now();
  const { share: _share, ...base } = src;
  const record: NotebookRecord = { ...base, id: newId(), title, favorite: false, createdAt: now, updatedAt: now, openedAt: 0 };
  record.pageCount = await createNotebookDoc(record, { update });
  await db.notebooks.add(record);
  return record;
}

export async function deleteNotebook(id: ID) {
  await db.notebooks.delete(id);
  await deleteNotebookDoc(id);
}
