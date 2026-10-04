import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { addElements, initNotebook, listPages, pageElements } from '../src/core/model/notebookDoc';
import { defaultTemplate } from '../src/core/model/paper';
import { encodePoints } from '../src/core/model/pointCodec';
import { base64ToBytes, bytesToBase64, docToJson, jsonToDoc } from '../src/core/model/serialize';
import type { StrokeElement } from '../src/core/model/types';

describe('sérialisation JSON', () => {
  it('base64 aller-retour', () => {
    const bytes = new Uint8Array(70000).map((_, i) => i % 251);
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
  });

  it('reconstruit un carnet identique depuis son JSON', () => {
    const doc = new Y.Doc();
    initNotebook(doc, 'Chimie', { width: 595, height: 842, template: defaultTemplate('grid') });
    const pageId = listPages(doc)[0].id;
    const el: StrokeElement = {
      type: 'stroke', id: 's1', z: 5, tool: 'pen', brush: 'fountain', color: '#2f5fd0', width: 1.4, opacity: 1,
      dash: 'solid', pressure: true, points: encodePoints([1, 2, 0.5, 0, 3, 4, 0.7, 8]), bbox: [0, 1, 4, 5], t0: 123,
      transform: [1, 0, 0, 1, 10, 20],
    };
    addElements(doc, pageId, [el]);

    const json = JSON.parse(JSON.stringify(docToJson(doc)));
    expect(json.title).toBe('Chimie');
    expect(typeof json.pages[0].elements[0].points).toBe('string');

    const copy = jsonToDoc(json);
    expect(listPages(copy)).toEqual(listPages(doc));
    const back = pageElements(copy, pageId)!.get('s1')!;
    expect(Array.from(back.points)).toEqual(Array.from(el.points));
    expect(back.transform).toEqual(el.transform);
    expect(back.color).toBe('#2f5fd0');
  });
});
