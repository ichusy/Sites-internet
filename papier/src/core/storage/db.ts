import Dexie, { type Table } from 'dexie';
import type { AssetRecord, FolderRecord, NotebookRecord, TemplateRecord } from '../model/types';

/**
 * Base IndexedDB « papier » : index de la bibliothèque et fichiers binaires.
 * Le contenu de chaque carnet vit dans sa propre base Yjs (voir notebookStore.ts).
 */
class PapierDB extends Dexie {
  folders!: Table<FolderRecord, string>;
  notebooks!: Table<NotebookRecord, string>;
  assets!: Table<AssetRecord, string>;
  templates!: Table<TemplateRecord, string>;

  constructor() {
    super('papier');
    this.version(1).stores({
      folders: 'id, parentId',
      notebooks: 'id, folderId, updatedAt, openedAt, title',
      assets: 'id',
    });
    this.version(2).stores({ templates: 'id, createdAt' });
  }
}

export const db = new PapierDB();

/** Demande au navigateur de ne pas effacer nos données en cas de manque d'espace. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
