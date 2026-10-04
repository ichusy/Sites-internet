import { describe, expect, it } from 'vitest';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import * as Y from 'yjs';
import { addElements, initNotebook, insertPage, listPages } from '../src/core/model/notebookDoc';
import { defaultTemplate } from '../src/core/model/paper';
import { encodePoints } from '../src/core/model/pointCodec';
import type { StrokeElement } from '../src/core/model/types';
import { exportPdf } from '../src/pdf/exportPdf';

function stroke(id: string, tool: 'pen' | 'highlighter'): StrokeElement {
  return {
    type: 'stroke', id, z: 1, tool, brush: 'ballpoint', color: tool === 'pen' ? '#1f2430' : '#fff27a',
    width: tool === 'pen' ? 1.2 : 14, opacity: 1, dash: 'solid', pressure: false,
    points: encodePoints([50, 100, 0.5, 0, 150, 120, 0.5, 10, 250, 100, 0.5, 20]), bbox: [40, 90, 260, 130], t0: 0,
  };
}

async function contentOf(bytes: Uint8Array) {
  return PDFDocument.load(bytes);
}

/** Modes de fusion déclarés dans les ressources de la page. */
function blendModes(pdf: PDFDocument, index: number): string[] {
  const res = pdf.getPage(index).node.Resources();
  const states = res?.lookupMaybe(PDFName.of('ExtGState'), PDFDict);
  if (!states) return [];
  return states.entries().map(([, ref]) => String(pdf.context.lookup(ref, PDFDict).get(PDFName.of('BM'))));
}

describe('export PDF', () => {
  it('produit une page par page du carnet, au bon format, avec l’encre en vectoriel', async () => {
    const doc = new Y.Doc();
    initNotebook(doc, 'Physique', { width: 595.28, height: 841.89, template: defaultTemplate('lined') });
    insertPage(doc, { id: 'p2', width: 841.89, height: 595.28, template: defaultTemplate('grid') }, 1);
    addElements(doc, listPages(doc)[0].id, [stroke('a', 'pen'), stroke('b', 'highlighter')]);

    const bytes = await exportPdf(doc, { annotations: true });
    const pdf = await contentOf(bytes);
    expect(pdf.getPageCount()).toBe(2);
    expect(pdf.getTitle()).toBe('Physique');
    const [w, h] = [pdf.getPage(1).getWidth(), pdf.getPage(1).getHeight()];
    expect(Math.round(w)).toBe(842);
    expect(Math.round(h)).toBe(595);

    // Surligneur en mode de fusion « multiply », encre en mode normal.
    expect(blendModes(pdf, 0).sort()).toEqual(['/Multiply', '/Normal']);
  });

  it('sans annotations : aucun état graphique de surligneur', async () => {
    const doc = new Y.Doc();
    initNotebook(doc, 'Propre', { width: 595, height: 842, template: defaultTemplate('blank') });
    addElements(doc, listPages(doc)[0].id, [stroke('b', 'highlighter')]);
    const pdf = await contentOf(await exportPdf(doc, { annotations: false }));
    expect(blendModes(pdf, 0)).toEqual([]);
  });
});
