import { PAPER_FORMATS, defaultTemplate } from '../core/model/paper';
import type { CoverSpec, ID, NotebookRecord, PageData } from '../core/model/types';
import { putAsset } from '../core/storage/assets';
import { createNotebook } from '../core/storage/library';
import { openPdf } from './pdfjs';

export type ImportedPage = Omit<PageData, 'id'>;

const A4 = PAPER_FORMATS[0];

export function isPdf(file: File) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

export function isImage(file: File) {
  return file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(file.name);
}

/** Une page par page du PDF, à sa taille d'origine (le PDF est conservé tel quel). */
export async function pagesFromPdf(file: Blob): Promise<ImportedPage[]> {
  const assetId = await putAsset(file.type ? file : new Blob([file], { type: 'application/pdf' }));
  const doc = await openPdf(new Uint8Array(await file.arrayBuffer()));
  try {
    const pages: ImportedPage[] = [];
    for (let i = 0; i < doc.numPages; i++) {
      const page = await doc.getPage(i + 1);
      const vp = page.getViewport({ scale: 1 });
      pages.push({
        width: vp.width,
        height: vp.height,
        template: defaultTemplate('blank'),
        background: { kind: 'pdf', assetId, pageIndex: i },
      });
      page.cleanup();
    }
    return pages;
  } finally {
    await doc.loadingTask.destroy();
  }
}

/** Une image = une page à la largeur d'un A4 (portrait) ou d'un A4 paysage. */
export async function pageFromImage(file: Blob): Promise<ImportedPage> {
  const bitmap = await createImageBitmap(file);
  const { width: iw, height: ih } = bitmap;
  bitmap.close();
  const assetId = await putAsset(file);
  const width = iw > ih ? A4.height : A4.width;
  return { width, height: (width * ih) / iw, template: defaultTemplate('blank'), background: { kind: 'image', assetId } };
}

/** Convertit des fichiers (PDF et images, dans l'ordre) en pages. Les fichiers non pris en charge sont ignorés. */
export async function pagesFromFiles(files: File[]): Promise<ImportedPage[]> {
  const pages: ImportedPage[] = [];
  for (const f of files) {
    if (isPdf(f)) pages.push(...(await pagesFromPdf(f)));
    else if (isImage(f)) pages.push(await pageFromImage(f));
  }
  return pages;
}

function baseName(name: string) {
  return name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Document importé';
}

/** Crée un carnet à partir de PDF et/ou d'images. */
export async function importAsNotebook(files: File[], folderId: ID | null, cover: CoverSpec): Promise<NotebookRecord | null> {
  const pages = await pagesFromFiles(files);
  if (!pages.length) return null;
  return createNotebook({
    title: baseName(files[0].name),
    folderId,
    cover,
    paper: { width: A4.width, height: A4.height },
    template: defaultTemplate('lined'),
    pages,
  });
}
