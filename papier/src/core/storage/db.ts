import Dexie, { type Table } from 'dexie';
import type { RecordingSpan } from '../model/types';
import type {
  AssetRecord, FolderRecord, NotebookIndexRecord, NotebookRecord, PdfMetaRecord, PdfPageTextRecord, TemplateRecord,
} from '../model/types';

/**
 * Base IndexedDB « papier » : index de la bibliothèque et fichiers binaires.
 * Le contenu de chaque carnet vit dans sa propre base Yjs (voir notebookStore.ts).
 */
/** Enregistrement en cours (ou interrompu) : l'audio est écrit au fil de l'eau pour ne rien perdre. */
export interface RecordingDraft {
  id: string;
  notebookId: string;
  mime: string;
  createdAt: number;
  spans: RecordingSpan[];
}

export interface RecordingChunk {
  seq?: number;
  recordingId: string;
  blob: Blob;
}

/** État de synchronisation d'un carnet avec le serveur (propre à l'appareil). */
export interface SyncStateRecord {
  id: string;
  /** Dernière modification (locale ou annoncée par le serveur) à envoyer ou recevoir. */
  dirtyAt: number;
  /** Début de la dernière synchronisation réussie. */
  syncedAt: number;
  /** Dernière erreur (accès retiré, carnet supprimé du serveur…). */
  error?: string;
}

class PapierDB extends Dexie {
  folders!: Table<FolderRecord, string>;
  notebooks!: Table<NotebookRecord, string>;
  assets!: Table<AssetRecord, string>;
  templates!: Table<TemplateRecord, string>;
  /** Données dérivées, recalculables : texte et structure des PDF, index de recherche. */
  pdftext!: Table<PdfPageTextRecord, string>;
  pdfmeta!: Table<PdfMetaRecord, string>;
  searchindex!: Table<NotebookIndexRecord, string>;
  /** Enregistrements audio en cours : métadonnées et morceaux, assemblés à l'arrêt. */
  recdrafts!: Table<RecordingDraft, string>;
  recchunks!: Table<RecordingChunk, number>;
  syncstate!: Table<SyncStateRecord, string>;

  constructor() {
    super('papier');
    this.version(1).stores({
      folders: 'id, parentId',
      notebooks: 'id, folderId, updatedAt, openedAt, title',
      assets: 'id',
    });
    this.version(2).stores({ templates: 'id, createdAt' });
    this.version(3).stores({ pdftext: 'id, assetId', pdfmeta: 'assetId', searchindex: 'notebookId' });
    this.version(4).stores({ recdrafts: 'id, notebookId', recchunks: '++seq, recordingId' });
    this.version(5).stores({ syncstate: 'id' });
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
