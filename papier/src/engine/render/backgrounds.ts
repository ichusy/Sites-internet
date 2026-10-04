import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { ID, PageBackground, PageData } from '../../core/model/types';
import type { RenderResources } from './draw';
import { getAsset } from '../../core/storage/assets';
import { openPdf } from '../../pdf/pdfjs';

/** Taille maximale d'un rendu de page PDF (pixels). */
const MAX_PIXELS = 8_000_000;
/** Nombre de rendus de pages PDF gardés en mémoire. */
const MAX_RENDERS = 12;

interface Rendered {
  canvas: HTMLCanvasElement;
  scale: number;
  lastUsed: number;
}

function key(bg: PageBackground) {
  return bg.kind === 'pdf' ? `${bg.assetId}#${bg.pageIndex}` : bg.assetId;
}

/** Échelles quantifiées par pas de √2 pour limiter le nombre de rendus. */
function quantize(scale: number) {
  return Math.pow(2, Math.ceil(Math.log2(Math.max(scale, 0.05)) * 2) / 2);
}

/**
 * Fonds de page importés (pages de PDF, images).
 * `get()` renvoie immédiatement le meilleur rendu disponible (ou null) et lance
 * en arrière-plan un rendu plus net si besoin ; `onReady` prévient quand il est prêt.
 */
export class BackgroundStore implements RenderResources {
  private pdfs = new Map<ID, Promise<PDFDocumentProxy | null>>();
  private images = new Map<ID, ImageBitmap | null>();
  private imageLoads = new Set<ID>();
  private renders = new Map<string, Rendered>();
  private queue = new Map<string, { bg: Extract<PageBackground, { kind: 'pdf' }>; scale: number; width: number }>();
  private busy = false;
  private destroyed = false;

  constructor(private onReady: (bg: PageBackground) => void) {}

  get(bg: PageBackground, pageWidth: number, pageHeight: number, scale: number): CanvasImageSource | null {
    if (bg.kind === 'image') return this.getImage(bg);
    const k = key(bg);
    const have = this.renders.get(k);
    const cap = Math.sqrt(MAX_PIXELS / (pageWidth * pageHeight));
    const wanted = Math.min(quantize(scale), cap);
    if (!have || have.scale < wanted * 0.99) {
      const queued = this.queue.get(k);
      if (!queued || queued.scale < wanted) this.queue.set(k, { bg, scale: wanted, width: pageWidth });
      void this.pump();
    }
    if (have) have.lastUsed = performance.now();
    return have?.canvas ?? null;
  }

  image(assetId: ID): CanvasImageSource | null {
    return this.getImage({ kind: 'image', assetId });
  }

  pageBackground(page: PageData, scale: number): CanvasImageSource | null {
    return page.background ? this.get(page.background, page.width, page.height, scale) : null;
  }

  templateImage(page: PageData, scale: number): CanvasImageSource | null {
    const src = page.template.kind === 'custom' ? page.template.source : undefined;
    if (!src) return null;
    const bg: PageBackground = src.kind === 'pdf' ? { kind: 'pdf', assetId: src.assetId, pageIndex: src.pageIndex } : { kind: 'image', assetId: src.assetId };
    return this.get(bg, page.width, page.height, scale);
  }

  destroy() {
    this.destroyed = true;
    this.queue.clear();
    for (const p of this.pdfs.values()) void p.then((d) => d?.loadingTask.destroy());
    for (const img of this.images.values()) img?.close();
    this.renders.clear();
  }

  private getImage(bg: Extract<PageBackground, { kind: 'image' }>): CanvasImageSource | null {
    const img = this.images.get(bg.assetId);
    if (img !== undefined) return img;
    if (!this.imageLoads.has(bg.assetId)) {
      this.imageLoads.add(bg.assetId);
      void (async () => {
        try {
          const rec = await getAsset(bg.assetId);
          this.images.set(bg.assetId, rec ? await createImageBitmap(rec.blob) : null);
        } catch {
          this.images.set(bg.assetId, null);
        }
        if (!this.destroyed) this.onReady(bg);
      })();
    }
    return null;
  }

  private pdf(assetId: ID): Promise<PDFDocumentProxy | null> {
    let p = this.pdfs.get(assetId);
    if (!p) {
      p = (async () => {
        const rec = await getAsset(assetId);
        if (!rec) return null;
        return openPdf(new Uint8Array(await rec.blob.arrayBuffer()));
      })().catch((err) => {
        console.error('PDF illisible', err);
        return null;
      });
      this.pdfs.set(assetId, p);
    }
    return p;
  }

  /** Traite les rendus un par un, le plus récent demandé en premier. */
  private async pump() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queue.size && !this.destroyed) {
        const [k, job] = [...this.queue.entries()].pop()!;
        this.queue.delete(k);
        const doc = await this.pdf(job.bg.assetId);
        if (!doc || this.destroyed) continue;
        const page = await doc.getPage(job.bg.pageIndex + 1);
        // L'échelle est exprimée par rapport à la taille de la page dans Papier (points).
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: job.scale * (job.width / base.width) });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        await page.render({ canvas, viewport }).promise;
        page.cleanup();
        if (this.destroyed) return;
        this.renders.set(k, { canvas, scale: job.scale, lastUsed: performance.now() });
        this.evict();
        this.onReady(job.bg);
      }
    } catch (err) {
      console.error('Rendu PDF impossible', err);
    } finally {
      this.busy = false;
    }
  }

  private evict() {
    if (this.renders.size <= MAX_RENDERS) return;
    const sorted = [...this.renders.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    while (this.renders.size > MAX_RENDERS) this.renders.delete(sorted.shift()![0]);
  }
}
