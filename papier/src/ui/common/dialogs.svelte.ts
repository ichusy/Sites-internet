import type { CoverSpec, ID, NotebookRecord, TemplateRef } from '../../core/model/types';

export interface NotebookForm {
  title: string;
  cover: CoverSpec;
  paper: { width: number; height: number };
  template: TemplateRef;
}

type Request =
  | { kind: 'prompt'; title: string; label: string; value: string; confirm: string; resolve: (v: string | null) => void }
  | { kind: 'confirm'; title: string; message: string; confirm: string; danger: boolean; resolve: (v: boolean) => void }
  | { kind: 'folder'; title: string; exclude: ID | null; resolve: (v: { folderId: ID | null } | null) => void }
  | { kind: 'notebook'; record: NotebookRecord | null; resolve: (v: NotebookForm | null) => void };

/** Boîte de dialogue affichée par DialogHost (une seule à la fois). */
export const dialogs = $state<{ current: Request | null }>({ current: null });

function open<T>(make: (resolve: (v: T) => void) => Request): Promise<T> {
  return new Promise<T>((resolve) => {
    dialogs.current = make((v) => {
      dialogs.current = null;
      resolve(v);
    });
  });
}

export function askText(title: string, label: string, value = '', confirm = 'Valider') {
  return open<string | null>((resolve) => ({ kind: 'prompt', title, label, value, confirm, resolve }));
}

export function askConfirm(title: string, message: string, confirm = 'Confirmer', danger = false) {
  return open<boolean>((resolve) => ({ kind: 'confirm', title, message, confirm, danger, resolve }));
}

/** Choix d'un dossier de destination ; `exclude` masque un dossier et ses descendants. */
export function askFolder(title: string, exclude: ID | null = null) {
  return open<{ folderId: ID | null } | null>((resolve) => ({ kind: 'folder', title, exclude, resolve }));
}

export function askNotebook(record: NotebookRecord | null = null) {
  return open<NotebookForm | null>((resolve) => ({ kind: 'notebook', record, resolve }));
}
