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

describe('export PDF — étape 2', () => {
  it('exporte texte accentué, forme, crayon et modèle Cornell (libellés en Helvetica)', async () => {
    const doc = new Y.Doc();
    initNotebook(doc, 'Révisions', { width: 595.28, height: 841.89, template: defaultTemplate('cornell') });
    const pageId = listPages(doc)[0].id;
    const shape: StrokeElement = {
      ...stroke('rect', 'pen'), shape: 'rect', closed: true,
      points: encodePoints([100, 100, 0.5, 0, 200, 100, 0.5, 0, 200, 160, 0.5, 0, 100, 160, 0.5, 0]),
    };
    const pencil: StrokeElement = { ...stroke('crayon', 'pen'), tool: 'pencil', opacity: 0.92 };
    addElements(doc, pageId, [
      shape,
      pencil,
      {
        type: 'text', id: 't1', z: 3, bbox: [50, 300, 350, 340], x: 50, y: 300, width: 300, height: 40,
        text: 'Mitochondrie : « centrale énergétique » — ATP\nDeuxième ligne ✓', fontSize: 14, color: '#2f5fd0',
        transform: [0.9, 0.2, -0.2, 0.9, 10, 5],
      },
    ]);
    const bytes = await exportPdf(doc, { annotations: true });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    const fonts = pdf.getPage(0).node.Resources()?.lookupMaybe(PDFName.of('Font'), PDFDict);
    expect(fonts?.entries().length).toBeGreaterThan(0);
    // Crayon (opacité réduite) et encre normale : états graphiques distincts.
    expect(blendModes(pdf, 0)).toContain('/Normal');
  });
});

describe('export PDF — tableau blanc', () => {
  it('produit une page à la taille du contenu, avec post-its et connecteur', async () => {
    const doc = new Y.Doc();
    initNotebook(doc, 'Carte mentale', { width: 1000, height: 1000, template: { kind: 'dots', spacing: 20 }, infinite: true });
    const pageId = listPages(doc)[0].id;
    expect(listPages(doc)[0].infinite).toBe(true);
    addElements(doc, pageId, [
      { type: 'sticky', id: 'a', z: 1, bbox: [-500, -100, -340, 60], x: -500, y: -100, width: 160, height: 160, color: '#fff3a3', text: 'Cellule', fontSize: 14 },
      { type: 'sticky', id: 'b', z: 2, bbox: [200, 300, 360, 460], x: 200, y: 300, width: 160, height: 160, color: '#cbe6ff', text: 'Noyau', fontSize: 14 },
      {
        type: 'connector', id: 'c', z: 3, bbox: [-420, -20, 280, 380], color: '#5b6474', width: 1.6, arrow: 'end', dash: 'solid',
        from: { id: 'a', x: -420, y: -20 }, to: { id: 'b', x: 280, y: 380 },
      },
    ]);
    const pdf = await PDFDocument.load(await exportPdf(doc, { annotations: true }));
    expect(pdf.getPageCount()).toBe(1);
    const p = pdf.getPage(0);
    // Contenu de x = -500 à 360 (et un peu de marge du connecteur) : la page s'y ajuste.
    expect(p.getWidth()).toBeGreaterThan(860);
    expect(p.getWidth()).toBeLessThan(1100);
    expect(p.node.Resources()?.lookupMaybe(PDFName.of('Font'), PDFDict)).toBeTruthy();
  });
});
