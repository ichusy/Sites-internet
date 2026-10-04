import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { addElements, initNotebook, listPages, listRecordings, pageElements, putRecording } from '../src/core/model/notebookDoc';
import { defaultTemplate } from '../src/core/model/paper';
import { encodePoints } from '../src/core/model/pointCodec';
import { base64ToBytes, bytesToBase64, docToJson, jsonToDoc } from '../src/core/model/serialize';
import type { RecordingData, StrokeElement } from '../src/core/model/types';
import { buildIndex } from '../src/core/search/notebookIndex';

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
    const back = pageElements(copy, pageId)!.get('s1') as StrokeElement;
    expect(Array.from(back.points)).toEqual(Array.from(el.points));
    expect(back.transform).toEqual(el.transform);
    expect(back.color).toBe('#2f5fd0');
  });

  it('conserve les enregistrements audio et leur transcription', () => {
    const doc = new Y.Doc();
    initNotebook(doc, 'Bio', { width: 595, height: 842, template: defaultTemplate('lined') });
    const rec: RecordingData = {
      id: 'r1', assetId: 'abc', mime: 'audio/webm;codecs=opus', title: 'Cours 1', createdAt: 1000, duration: 12,
      spans: [{ start: 1000, end: 13000, offset: 0 }],
      transcript: { provider: 'whisper-local', model: 'onnx-community/whisper-base', language: 'fr', createdAt: 2000, segments: [{ start: 0, end: 4, text: 'La mitochondrie' }] },
    };
    putRecording(doc, rec);
    const copy = jsonToDoc(JSON.parse(JSON.stringify(docToJson(doc))));
    expect(listRecordings(copy)).toEqual([rec]);
    expect(buildIndex('nb', copy).audio).toEqual([{ recordingId: 'r1', title: 'Cours 1', texts: ['La mitochondrie'] }]);
  });
});
