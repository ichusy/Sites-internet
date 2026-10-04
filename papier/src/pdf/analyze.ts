import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { BBox, ID, PdfLink, PdfMetaRecord, PdfOutlineNode, PdfPageTextRecord, PdfTarget, PdfTextItem } from '../core/model/types';
import { getAsset } from '../core/storage/assets';
import { db } from '../core/storage/db';
import { loadPdfjs, openPdf } from './pdfjs';

/** À incrémenter si le format des données extraites change (réanalyse automatique). */
export const ANALYSIS_VERSION = 1;

const inflight = new Map<ID, Promise<PdfMetaRecord | null>>();

/**
 * Garantit que le PDF a été analysé (texte positionné, sommaire, liens).
 * Plusieurs appels simultanés partagent la même analyse. Résultat mis en cache dans IndexedDB.
 */
export function ensurePdfAnalyzed(assetId: ID, name = 'PDF'): Promise<PdfMetaRecord | null> {
  let p = inflight.get(assetId);
  if (!p) {
    p = (async () => {
      const existing = await db.pdfmeta.get(assetId);
      if (existing && existing.version === ANALYSIS_VERSION) return existing;
      return analyze(assetId, existing?.name ?? name);
    })()
      .catch((err) => {
        console.error('Analyse du PDF impossible', err);
        return null;
      })
      .finally(() => inflight.delete(assetId));
    inflight.set(assetId, p);
  }
  return p;
}

export async function pdfPageTexts(assetId: ID): Promise<PdfPageTextRecord[]> {
  return db.pdftext.where('assetId').equals(assetId).toArray();
}

/** Texte d'une page de PDF, morceaux séparés par des espaces ou des retours à la ligne. */
export function pageString(items: PdfTextItem[]): string {
  return items.map((it) => it.s + (it.eol ? '\n' : ' ')).join('');
}

type Dest = unknown[] | string | null;

/** Résout une destination PDF (nommée ou explicite) en numéro de page et position verticale. */
async function resolveDest(doc: PDFDocumentProxy, dest: Dest): Promise<PdfTarget | null> {
  try {
    const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(explicit) || !explicit.length) return null;
    const ref = explicit[0];
    let pageIndex: number;
    if (Number.isInteger(ref)) pageIndex = ref as number;
    else if (ref && typeof ref === 'object') pageIndex = await doc.getPageIndex(ref as Parameters<PDFDocumentProxy['getPageIndex']>[0]);
    else return null;
    const kind = (explicit[1] as { name?: string } | undefined)?.name;
    const userTop = kind === 'XYZ' ? explicit[3] : kind === 'FitH' || kind === 'FitBH' ? explicit[2] : null;
    const target: PdfTarget = { pageIndex };
    if (typeof userTop === 'number') {
      const page = await doc.getPage(pageIndex + 1);
      const [, y] = page.getViewport({ scale: 1 }).convertToViewportPoint(0, userTop);
      target.top = Math.max(0, y);
    }
    return target;
  } catch {
    return null;
  }
}

function safeUrl(url: unknown): string | undefined {
  return typeof url === 'string' && /^(https?:|mailto:)/i.test(url) ? url : undefined;
}

type RawOutline = { title: string; dest: Dest; url: string | null; items: RawOutline[] };

async function convertOutline(doc: PDFDocumentProxy, nodes: RawOutline[]): Promise<PdfOutlineNode[]> {
  const out: PdfOutlineNode[] = [];
  for (const n of nodes) {
    const target = n.url ? { url: safeUrl(n.url) } : ((await resolveDest(doc, n.dest)) ?? {});
    const title = (n.title || '').replace(/[\u0000-\u001f]+/g, ' ').trim() || 'Sans titre';
    out.push({ title, ...target, children: await convertOutline(doc, n.items ?? []) });
  }
  return out;
}

async function analyze(assetId: ID, name: string): Promise<PdfMetaRecord | null> {
  const rec = await getAsset(assetId);
  if (!rec) return null;
  const pdfjs = await loadPdfjs();
  const doc = await openPdf(new Uint8Array(await rec.blob.arrayBuffer()));
  try {
    const texts: PdfPageTextRecord[] = [];
    const links: PdfLink[][] = [];
    for (let i = 0; i < doc.numPages; i++) {
      const page = await doc.getPage(i + 1);
      const vp = page.getViewport({ scale: 1 });

      const content = await page.getTextContent();
      const items: PdfTextItem[] = [];
      for (const raw of content.items) {
        if (!('str' in raw)) continue;
        const it = raw as { str: string; transform: number[]; width: number; hasEOL: boolean };
        if (!it.str && !it.hasEOL) continue;
        const tx = pdfjs.Util.transform(vp.transform, it.transform) as number[];
        const fontH = Math.hypot(tx[2], tx[3]);
        const item: PdfTextItem = { s: it.str, x: tx[4], y: tx[5] - fontH * 0.85, w: it.width * vp.scale, h: fontH * 1.1 };
        if (it.hasEOL) item.eol = true;
        items.push(item);
      }
      texts.push({ id: `${assetId}#${i}`, assetId, pageIndex: i, items });

      const pageLinks: PdfLink[] = [];
      for (const a of await page.getAnnotations()) {
        if (a.subtype !== 'Link' || !Array.isArray(a.rect)) continue;
        const [x1, y1] = vp.convertToViewportPoint(a.rect[0], a.rect[1]) as number[];
        const [x2, y2] = vp.convertToViewportPoint(a.rect[2], a.rect[3]) as number[];
        const rect: BBox = [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
        const url = safeUrl(a.url ?? a.unsafeUrl);
        if (url) pageLinks.push({ rect, url });
        else if (a.dest) {
          const target = await resolveDest(doc, a.dest);
          if (target) pageLinks.push({ rect, ...target });
        }
      }
      links.push(pageLinks);
      page.cleanup();
    }

    const meta: PdfMetaRecord = {
      assetId,
      name,
      numPages: doc.numPages,
      outline: await convertOutline(doc, ((await doc.getOutline()) ?? []) as RawOutline[]),
      links,
      version: ANALYSIS_VERSION,
      analyzedAt: Date.now(),
    };
    await db.transaction('rw', db.pdftext, db.pdfmeta, async () => {
      await db.pdftext.where('assetId').equals(assetId).delete();
      await db.pdftext.bulkPut(texts);
      await db.pdfmeta.put(meta);
    });
    return meta;
  } finally {
    await doc.loadingTask.destroy();
  }
}
