import type * as PdfLib from 'pdf-lib';
import type * as Y from 'yjs';
import { listPages, pageElements, roots } from '../core/model/notebookDoc';
import type { BBox, ID, Mat2D, PageData } from '../core/model/types';
import { getAsset } from '../core/storage/assets';
import { invertMat, multiplyMat } from '../engine/geometry/geom';
import { strokeOutline, traceCenterline, traceOutline, type PathSink } from '../engine/ink/brushes';
import { DOT_COLOR, LINE_COLOR, MARGIN_COLOR, templatePrimitives, type Segment } from '../engine/render/templates';
import { makeItem, type RenderItem } from '../engine/scene';
import { openPdf } from './pdfjs';

export interface ExportOptions {
  /** false = document « propre » : pages d'origine et modèles, sans encre ni surligneur. */
  annotations: boolean;
}

/**
 * Transformation « espace utilisateur PDF → repère de page Papier (points, Y vers le bas) »,
 * identique à celle de pdf.js à l'échelle 1 (PageViewport). `box` = [x0, y0, x1, y1].
 */
export function viewportTransform(rotation: number, box: BBox): { m: Mat2D; width: number; height: number } {
  const rot = ((rotation % 360) + 360) % 360;
  const [x0, y0, x1, y1] = box;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const [A, B, C, D] = rot === 90 ? [0, 1, 1, 0] : rot === 180 ? [-1, 0, 0, 1] : rot === 270 ? [0, -1, -1, 0] : [1, 0, 0, -1];
  let ox: number, oy: number, width: number, height: number;
  if (A === 0) {
    ox = Math.abs(cy - y0);
    oy = Math.abs(cx - x0);
    width = Math.abs(y1 - y0);
    height = Math.abs(x1 - x0);
  } else {
    ox = Math.abs(cx - x0);
    oy = Math.abs(cy - y0);
    width = Math.abs(x1 - x0);
    height = Math.abs(y1 - y0);
  }
  return { m: [A, B, C, D, ox - A * cx - C * cy, oy - B * cx - D * cy], width, height };
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

type Lib = typeof PdfLib;

/** Construit les opérateurs PDF d'un chemin (les quadratiques deviennent des Bézier cubiques). */
function pdfSink(lib: Lib, ops: PdfLib.PDFOperator[]): PathSink {
  let cx = 0, cy = 0;
  return {
    moveTo(x, y) {
      ops.push(lib.moveTo(x, y));
      cx = x;
      cy = y;
    },
    lineTo(x, y) {
      ops.push(lib.lineTo(x, y));
      cx = x;
      cy = y;
    },
    quadTo(qx, qy, x, y) {
      ops.push(
        lib.appendBezierCurve(cx + (2 / 3) * (qx - cx), cy + (2 / 3) * (qy - cy), x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), x, y),
      );
      cx = x;
      cy = y;
    },
    close() {
      ops.push(lib.closePath());
    },
  };
}

class PageWriter {
  private states = new Map<string, PdfLib.PDFName>();
  readonly ops: PdfLib.PDFOperator[] = [];

  constructor(private lib: Lib, private out: PdfLib.PDFDocument, private page: PdfLib.PDFPage) {}

  /** État graphique (mode de fusion, opacité), créé une seule fois par page. */
  private state(blend: 'Normal' | 'Multiply', opacity: number) {
    const key = `${blend}:${opacity}`;
    let name = this.states.get(key);
    if (!name) {
      const dict = this.out.context.obj({ Type: 'ExtGState', BM: blend, CA: opacity, ca: opacity });
      name = this.page.node.newExtGState('PapierGS', this.out.context.register(dict));
      this.states.set(key, name);
    }
    return name;
  }

  template(page: PageData) {
    const { lib, ops } = this;
    const prim = templatePrimitives(page);
    const segs = (list: Segment[], color: string) => {
      if (!list.length) return;
      ops.push(lib.setStrokingRgbColor(...hexToRgb(color)), lib.setLineWidth(0.5));
      for (const [x1, y1, x2, y2] of list) ops.push(lib.moveTo(x1, y1), lib.lineTo(x2, y2));
      ops.push(lib.stroke());
    };
    segs(prim.lines, LINE_COLOR);
    segs(prim.accents, MARGIN_COLOR);
    if (prim.dots.length) {
      ops.push(lib.setFillingRgbColor(...hexToRgb(DOT_COLOR)));
      const r = 1.1;
      for (const [x, y] of prim.dots) ops.push(lib.rectangle(x - r / 2, y - r / 2, r, r));
      ops.push(lib.fill());
    }
  }

  item(item: RenderItem) {
    const { lib, ops } = this;
    const el = item.el;
    ops.push(lib.pushGraphicsState(), lib.setGraphicsState(this.state(el.tool === 'highlighter' ? 'Multiply' : 'Normal', el.opacity)));
    const sink = pdfSink(lib, ops);
    if (el.tool === 'highlighter' || el.dash !== 'solid') {
      ops.push(lib.setStrokingRgbColor(...hexToRgb(el.color)), lib.setLineWidth(el.width), lib.setLineJoin(lib.LineJoinStyle.Round));
      if (el.tool === 'highlighter') {
        ops.push(lib.setLineCap(lib.LineCapStyle.Butt));
      } else if (el.dash === 'dotted') {
        ops.push(lib.setLineCap(lib.LineCapStyle.Round), lib.setDashPattern([0, el.width * 2.2], 0));
      } else {
        ops.push(lib.setLineCap(lib.LineCapStyle.Butt), lib.setDashPattern([el.width * 4, el.width * 2.5], 0));
      }
      traceCenterline(item.pts, sink);
      ops.push(lib.stroke());
    } else {
      ops.push(lib.setFillingRgbColor(...hexToRgb(el.color)));
      traceOutline(strokeOutline(item.pts, el.brush, el.width, el.pressure, true), sink);
      ops.push(lib.fill());
    }
    ops.push(lib.popGraphicsState());
  }
}

async function assetBytes(id: ID) {
  const rec = await getAsset(id);
  return rec ? { bytes: new Uint8Array(await rec.blob.arrayBuffer()), mime: rec.mime, blob: rec.blob } : null;
}

/** PNG/JPEG intégrés tels quels ; les autres formats sont convertis en PNG. */
async function embedImage(out: PdfLib.PDFDocument, asset: { bytes: Uint8Array; mime: string; blob: Blob }) {
  if (asset.mime === 'image/png') return out.embedPng(asset.bytes);
  if (asset.mime === 'image/jpeg') return out.embedJpg(asset.bytes);
  const bitmap = await createImageBitmap(asset.blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  bitmap.close();
  const png = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('PNG'))), 'image/png'));
  return out.embedPng(new Uint8Array(await png.arrayBuffer()));
}

/** Secours pour un PDF que pdf-lib ne sait pas recopier (chiffré, malformé) : page rastérisée à 150 dpi. */
async function rasterizePdfPage(bytes: Uint8Array, pageIndex: number): Promise<Uint8Array> {
  const doc = await openPdf(bytes);
  try {
    const page = await doc.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale: 150 / 72 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvas, viewport }).promise;
    const png = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('PNG'))), 'image/png'));
    return new Uint8Array(await png.arrayBuffer());
  } finally {
    await doc.loadingTask.destroy();
  }
}

/** Exporte un carnet en PDF. L'encre reste vectorielle ; les pages PDF importées sont recopiées à l'identique. */
export async function exportPdf(doc: Y.Doc, opts: ExportOptions): Promise<Uint8Array> {
  const lib = await import('pdf-lib');
  const out = await lib.PDFDocument.create();
  const title = (roots(doc).meta.get('title') as string) || 'Carnet';
  out.setTitle(title);
  out.setCreator('Papier');
  out.setProducer('Papier (pdf-lib)');

  const sources = new Map<ID, Promise<{ pdf: PdfLib.PDFDocument | null; bytes: Uint8Array } | null>>();
  const source = (id: ID) => {
    if (!sources.has(id)) {
      sources.set(
        id,
        assetBytes(id).then(async (a) => {
          if (!a) return null;
          const pdf = await lib.PDFDocument.load(a.bytes, { ignoreEncryption: true }).catch(() => null);
          return { pdf, bytes: a.bytes };
        }),
      );
    }
    return sources.get(id)!;
  };

  for (const page of listPages(doc)) {
    const bg = page.background;
    let pdfPage: PdfLib.PDFPage | null = null;
    // Repère Papier (Y vers le bas) → espace utilisateur PDF.
    let m: Mat2D = [1, 0, 0, -1, 0, page.height];

    if (bg?.kind === 'pdf') {
      const src = await source(bg.assetId);
      if (src?.pdf && !src.pdf.isEncrypted) {
        try {
          [pdfPage] = await out.copyPages(src.pdf, [bg.pageIndex]);
          out.addPage(pdfPage);
          // Isole le contenu d'origine (q … Q) : un « cm » non refermé ne doit pas décaler l'encre ajoutée.
          pdfPage.node.normalize();
          pdfPage.node.wrapContentStreams(
            out.context.register(out.context.contentStream([lib.pushGraphicsState()])),
            out.context.register(out.context.contentStream([lib.popGraphicsState()])),
          );
          const crop = pdfPage.getCropBox();
          const media = pdfPage.getMediaBox();
          const box: BBox = [
            Math.max(crop.x, media.x),
            Math.max(crop.y, media.y),
            Math.min(crop.x + crop.width, media.x + media.width),
            Math.min(crop.y + crop.height, media.y + media.height),
          ];
          const vt = viewportTransform(pdfPage.getRotation().angle, box);
          const s = vt.width / page.width;
          m = multiplyMat(invertMat(vt.m), [s, 0, 0, s, 0, 0]);
        } catch {
          pdfPage = null;
        }
      }
      if (!pdfPage && src) {
        pdfPage = out.addPage([page.width, page.height]);
        const img = await out.embedPng(await rasterizePdfPage(src.bytes, bg.pageIndex));
        pdfPage.drawImage(img, { x: 0, y: 0, width: page.width, height: page.height });
      }
    }
    if (!pdfPage) {
      pdfPage = out.addPage([page.width, page.height]);
      if (bg?.kind === 'image') {
        const a = await assetBytes(bg.assetId);
        if (a) pdfPage.drawImage(await embedImage(out, a), { x: 0, y: 0, width: page.width, height: page.height });
      }
    }

    const w = new PageWriter(lib, out, pdfPage);
    w.ops.push(lib.pushGraphicsState(), lib.concatTransformationMatrix(...m));
    w.ops.push(lib.rectangle(0, 0, page.width, page.height), lib.clip(), lib.endPath());
    w.template(page);
    if (opts.annotations) {
      const items = [...(pageElements(doc, page.id)?.values() ?? [])].map(makeItem).sort((a, b) => a.z - b.z);
      for (const it of items) if (it.el.tool === 'highlighter') w.item(it);
      for (const it of items) if (it.el.tool !== 'highlighter') w.item(it);
    }
    w.ops.push(lib.popGraphicsState());
    pdfPage.pushOperators(...w.ops);
  }

  return out.save();
}
