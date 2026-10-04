import { newId } from '../core/model/ids';
import type { TemplateRecord, TemplateRef } from '../core/model/types';
import { putAsset } from '../core/storage/assets';
import { db } from '../core/storage/db';
import { pickFiles } from '../io/files';
import { isPdf } from '../pdf/importFiles';
import { openPdf } from '../pdf/pdfjs';
import { showToast, withBusy } from './common/toast.svelte';

/** Référence de modèle à partir d'un modèle importé. */
export function customTemplateRef(t: TemplateRecord): TemplateRef {
  return { kind: 'custom', spacing: 0, source: { assetId: t.assetId, kind: t.kind, pageIndex: t.pageIndex, templateId: t.id, name: t.name } };
}

/** Importe une image ou la première page d'un PDF comme modèle de page réutilisable. */
export async function importTemplate(): Promise<TemplateRecord | null> {
  const [file] = await pickFiles('.pdf,application/pdf,image/*', false);
  if (!file) return null;
  const rec = await withBusy('Import du modèle…', async () => {
    const assetId = await putAsset(file);
    let width = 595.28;
    let height = 841.89;
    let kind: TemplateRecord['kind'] = 'image';
    if (isPdf(file)) {
      kind = 'pdf';
      const doc = await openPdf(new Uint8Array(await file.arrayBuffer()));
      const vp = (await doc.getPage(1)).getViewport({ scale: 1 });
      width = vp.width;
      height = vp.height;
      await doc.loadingTask.destroy();
    } else {
      const bmp = await createImageBitmap(file);
      height = (width * bmp.height) / bmp.width;
      bmp.close();
    }
    const t: TemplateRecord = {
      id: newId(),
      name: file.name.replace(/\.[^.]+$/, '') || 'Modèle',
      assetId,
      kind,
      pageIndex: 0,
      width,
      height,
      createdAt: Date.now(),
    };
    await db.templates.add(t);
    return t;
  });
  if (rec) showToast(`Modèle « ${rec.name} » ajouté.`);
  return rec ?? null;
}

export async function deleteTemplate(id: string) {
  await db.templates.delete(id);
}
