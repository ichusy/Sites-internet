import type * as PdfLib from 'pdf-lib';
import type * as Y from 'yjs';
import { listPages, pageElements, roots } from '../core/model/notebookDoc';
import type { BBox, ID, ImageElement, Mat2D, PageData, StrokeElement, TextElement } from '../core/model/types';
import { getAsset } from '../core/storage/assets';
import { invertMat, multiplyMat } from '../engine/geometry/geom';
import { strokeOutline, traceCenterline, traceOutline, tracePolyline, type PathSink } from '../engine/ink/brushes';
import {
  DOT_COLOR, LABEL_COLOR, LINE_COLOR, MARGIN_COLOR, STRUCTURE_COLOR, templatePrimitives, type Segment,
} from '../engine/render/templates';
import { BASELINE, LINE_HEIGHT, layoutText } from '../engine/render/text';
import { isCenterline, isHighlight, makeItem, type RenderItem } from '../engine/scene';
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

/** Ressources partagées par toutes les pages de l'export (polices, images intégrées). */
class ExportResources {
  private images = new Map<ID, Promise<PdfLib.PDFImage | null>>();
  private fontP: Promise<PdfLib.PDFFont> | null = null;
  font: PdfLib.PDFFont | null = null;
  private charset: Set<number> | null = null;

  constructor(readonly lib: Lib, readonly out: PdfLib.PDFDocument) {}

  image(id: ID): Promise<PdfLib.PDFImage | null> {
    let p = this.images.get(id);
    if (!p) {
      p = assetBytes(id).then((a) => (a ? embedImage(this.out, a) : null)).catch(() => null);
      this.images.set(id, p);
    }
    return p;
  }

  async ensureFont() {
    this.fontP ??= this.out.embedFont(this.lib.StandardFonts.Helvetica);
    this.font = await this.fontP;
    this.charset ??= new Set(this.font.getCharacterSet());
  }

  /** Remplace les caractères absents de la police standard (encodage WinAnsi). */
  sanitize(text: string) {
    return [...text.replace(/\t/g, '    ')].map((ch) => (ch === '\n' || this.charset!.has(ch.codePointAt(0)!) ? ch : '?')).join('');
  }
}

class PageWriter {
  private states = new Map<string, PdfLib.PDFName>();
  private xobjects = new Map<ID, PdfLib.PDFName>();
  private fontKey: PdfLib.PDFName | null = null;
  readonly ops: PdfLib.PDFOperator[] = [];

  constructor(
    private res: ExportResources,
    private page: PdfLib.PDFPage,
    private images: Map<ID, PdfLib.PDFImage | null>,
  ) {}

  private get lib() {
    return this.res.lib;
  }

  /** État graphique (mode de fusion, opacité), créé une seule fois par page. */
  private state(blend: 'Normal' | 'Multiply', opacity: number) {
    const key = `${blend}:${opacity}`;
    let name = this.states.get(key);
    if (!name) {
      const ctx = this.res.out.context;
      const dict = ctx.obj({ Type: 'ExtGState', BM: blend, CA: opacity, ca: opacity });
      name = this.page.node.newExtGState('PapierGS', ctx.register(dict));
      this.states.set(key, name);
    }
    return name;
  }

  private fontName() {
    if (!this.fontKey) {
      const font = this.res.font!;
      this.fontKey = this.page.node.newFontDictionary(font.name, font.ref);
    }
    return this.fontKey;
  }

  /** Lignes de texte à la ligne de base `y`, glyphes à l'endroit dans le repère Y vers le bas. */
  private textLines(lines: string[], x: number, y0: number, size: number, color: string) {
    const { lib, ops } = this;
    const font = this.res.font!;
    ops.push(lib.setFillingRgbColor(...hexToRgb(color)), lib.beginText(), lib.setFontAndSize(this.fontName(), size));
    lines.forEach((line, i) => {
      if (!line) return;
      ops.push(lib.setTextMatrix(1, 0, 0, -1, x, y0 + i * size * LINE_HEIGHT), lib.showText(font.encodeText(this.res.sanitize(line))));
    });
    ops.push(lib.endText());
  }

  template(page: PageData) {
    const { lib, ops } = this;
    const prim = templatePrimitives(page);
    const segs = (list: Segment[], color: string, width: number) => {
      if (!list.length) return;
      ops.push(lib.setStrokingRgbColor(...hexToRgb(color)), lib.setLineWidth(width));
      for (const [x1, y1, x2, y2] of list) ops.push(lib.moveTo(x1, y1), lib.lineTo(x2, y2));
      ops.push(lib.stroke());
    };
    segs(prim.lines, LINE_COLOR, 0.5);
    segs(prim.accents, MARGIN_COLOR, 0.5);
    segs(prim.structure, STRUCTURE_COLOR, 0.8);
    if (prim.dots.length) {
      ops.push(lib.setFillingRgbColor(...hexToRgb(DOT_COLOR)));
      const r = 1.1;
      for (const [x, y] of prim.dots) ops.push(lib.rectangle(x - r / 2, y - r / 2, r, r));
      ops.push(lib.fill());
    }
    for (const l of prim.labels) this.textLines([l.text], l.x, l.y, l.size, LABEL_COLOR);
  }

  item(item: RenderItem) {
    const el = item.el;
    if (el.type === 'stroke') this.stroke(item, el);
    else if (el.type === 'text') this.text(item, el);
    else this.image(item, el);
  }

  private stroke(item: RenderItem, el: StrokeElement) {
    const { lib, ops } = this;
    const blend = el.tool === 'highlighter' ? 'Multiply' : 'Normal';
    // Le grain du crayon n'existe pas en PDF : approché par une légère transparence.
    const opacity = el.tool === 'pencil' ? Math.min(el.opacity, 0.85) : el.opacity;
    ops.push(lib.pushGraphicsState(), lib.setGraphicsState(this.state(blend, opacity)));
    const sink = pdfSink(lib, ops);
    if (isCenterline(el)) {
      ops.push(lib.setStrokingRgbColor(...hexToRgb(el.color)), lib.setLineWidth(el.width), lib.setLineJoin(lib.LineJoinStyle.Round));
      const flatCap = el.tool === 'highlighter' && !el.shape;
      ops.push(lib.setLineCap(flatCap ? lib.LineCapStyle.Butt : lib.LineCapStyle.Round));
      if (el.dash === 'dotted') ops.push(lib.setLineCap(lib.LineCapStyle.Round), lib.setDashPattern([0, el.width * 2.2], 0));
      else if (el.dash === 'dashed') ops.push(lib.setLineCap(lib.LineCapStyle.Butt), lib.setDashPattern([el.width * 4, el.width * 2.5], 0));
      if (el.shape) tracePolyline(item.pts, !!el.closed, sink);
      else traceCenterline(item.pts, sink);
      ops.push(lib.stroke());
    } else {
      ops.push(lib.setFillingRgbColor(...hexToRgb(el.color)));
      traceOutline(strokeOutline(item.pts, el, true), sink);
      ops.push(lib.fill());
    }
    ops.push(lib.popGraphicsState());
  }

  private text(item: RenderItem, el: TextElement) {
    const font = this.res.font!;
    const lines = layoutText(this.res.sanitize(el.text), el.width, (s) => font.widthOfTextAtSize(s, el.fontSize));
    this.ops.push(this.lib.pushGraphicsState(), this.lib.concatTransformationMatrix(...item.matrix!));
    this.textLines(lines, el.x, el.y + el.fontSize * BASELINE, el.fontSize, el.color);
    this.ops.push(this.lib.popGraphicsState());
  }

  private image(item: RenderItem, el: ImageElement) {
    const img = this.images.get(el.assetId);
    if (!img) return;
    let name = this.xobjects.get(el.assetId);
    if (!name) {
      name = this.page.node.newXObject('PapierIm', img.ref);
      this.xobjects.set(el.assetId, name);
    }
    const { lib } = this;
    // Carré unité de l'image → rectangle (x, y, w, h) du repère Y vers le bas.
    this.ops.push(
      lib.pushGraphicsState(),
      lib.concatTransformationMatrix(...item.matrix!),
      lib.concatTransformationMatrix(el.width, 0, 0, -el.height, el.x, el.y + el.height),
      lib.drawObject(name),
      lib.popGraphicsState(),
    );
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
  const res = new ExportResources(lib, out);
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
      // Modèle importé (sous un éventuel fond image) : page de PDF intégrée en vectoriel ou image.
      const tpl = page.template.kind === 'custom' ? page.template.source : undefined;
      if (tpl?.kind === 'pdf') {
        const a = await assetBytes(tpl.assetId);
        const [emb] = a ? await out.embedPdf(a.bytes, [tpl.pageIndex]).catch(() => [null]) : [null];
        if (emb) pdfPage.drawPage(emb, { x: 0, y: 0, width: page.width, height: page.height });
      } else if (tpl?.kind === 'image') {
        const img = await res.image(tpl.assetId);
        if (img) pdfPage.drawImage(img, { x: 0, y: 0, width: page.width, height: page.height });
      }
      if (bg?.kind === 'image') {
        const img = await res.image(bg.assetId);
        if (img) pdfPage.drawImage(img, { x: 0, y: 0, width: page.width, height: page.height });
      }
    }

    const items = opts.annotations ? [...(pageElements(doc, page.id)?.values() ?? [])].map(makeItem).sort((a, b) => a.z - b.z) : [];
    const images = new Map<ID, PdfLib.PDFImage | null>();
    for (const it of items) if (it.el.type === 'image' && !images.has(it.el.assetId)) images.set(it.el.assetId, await res.image(it.el.assetId));
    if (items.some((it) => it.el.type === 'text') || templatePrimitives(page).labels.length) await res.ensureFont();

    const w = new PageWriter(res, pdfPage, images);
    w.ops.push(lib.pushGraphicsState(), lib.concatTransformationMatrix(...m));
    w.ops.push(lib.rectangle(0, 0, page.width, page.height), lib.clip(), lib.endPath());
    w.template(page);
    for (const it of items) if (isHighlight(it.el)) w.item(it);
    for (const it of items) if (!isHighlight(it.el)) w.item(it);
    w.ops.push(lib.popGraphicsState());
    pdfPage.pushOperators(...w.ops);
  }

  return out.save();
}
