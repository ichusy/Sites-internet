import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN, addElements, deletePage, duplicatePage, initNotebook, insertPage,
  listPages, movePage, pageElements, removeElements,
} from '../src/core/model/notebookDoc';
import { defaultTemplate } from '../src/core/model/paper';
import type { StrokeElement } from '../src/core/model/types';

const A4 = { width: 595, height: 842, template: defaultTemplate('lined') };

function stroke(id: string): StrokeElement {
  return {
    type: 'stroke', id, z: 1, tool: 'pen', brush: 'ballpoint', color: '#000000', width: 1,
    opacity: 1, dash: 'solid', pressure: false, points: new Uint8Array(16), bbox: [0, 0, 1, 1], t0: 0,
  };
}

function setup() {
  const doc = new Y.Doc();
  initNotebook(doc, 'Test', A4);
  return doc;
}

describe('document de carnet', () => {
  it('crée une première page', () => {
    const doc = setup();
    const pages = listPages(doc);
    expect(pages).toHaveLength(1);
    expect(pages[0].template.kind).toBe('lined');
  });

  it('n’initialise pas deux fois', () => {
    const doc = setup();
    initNotebook(doc, 'Test', A4);
    expect(listPages(doc)).toHaveLength(1);
  });

  it('ajoute, déplace et supprime des pages', () => {
    const doc = setup();
    const first = listPages(doc)[0].id;
    insertPage(doc, { ...A4, id: 'b' }, 1);
    insertPage(doc, { ...A4, id: 'c' }, 2);
    expect(listPages(doc).map((p) => p.id)).toEqual([first, 'b', 'c']);
    movePage(doc, 2, 0);
    expect(listPages(doc).map((p) => p.id)).toEqual(['c', first, 'b']);
    deletePage(doc, first);
    expect(listPages(doc).map((p) => p.id)).toEqual(['c', 'b']);
  });

  it('duplique une page avec ses éléments, sous de nouveaux identifiants', () => {
    const doc = setup();
    const first = listPages(doc)[0].id;
    addElements(doc, first, [stroke('s1'), stroke('s2')]);
    const copy = duplicatePage(doc, first)!;
    expect(listPages(doc).map((p) => p.id)).toEqual([first, copy]);
    const els = [...pageElements(doc, copy)!.values()];
    expect(els).toHaveLength(2);
    expect(els.map((e) => e.id)).not.toContain('s1');
  });

  it('annule et rétablit les ajouts et suppressions de traits', () => {
    const doc = setup();
    const first = listPages(doc)[0].id;
    const { pageOrder, pages } = { pageOrder: doc.getArray('pageOrder'), pages: doc.getMap('pages') };
    const undo = new Y.UndoManager([pageOrder, pages], { trackedOrigins: new Set([LOCAL_ORIGIN]), captureTimeout: 1e9 });
    doc.transact(() => addElements(doc, first, [stroke('s1')]), LOCAL_ORIGIN);
    undo.stopCapturing();
    doc.transact(() => removeElements(doc, first, ['s1']), LOCAL_ORIGIN);
    expect(pageElements(doc, first)!.size).toBe(0);
    undo.undo();
    expect(pageElements(doc, first)!.has('s1')).toBe(true);
    undo.undo();
    expect(pageElements(doc, first)!.size).toBe(0);
    undo.redo();
    expect(pageElements(doc, first)!.has('s1')).toBe(true);
  });

  it('conserve les points binaires après synchronisation entre deux documents', () => {
    const doc = setup();
    const first = listPages(doc)[0].id;
    const s = stroke('s1');
    s.points = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    addElements(doc, first, [s]);
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    const got = pageElements(other, first)!.get('s1')!;
    expect(got.points).toBeInstanceOf(Uint8Array);
    expect(Array.from(got.points)).toEqual(Array.from(s.points));
  });
});
