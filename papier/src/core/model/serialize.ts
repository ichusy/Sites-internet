import * as Y from 'yjs';
import { SCHEMA_VERSION, addElements, insertPage, listPages, pageElements, roots } from './notebookDoc';
import type { PageData, PageElement, StrokeElement } from './types';

/**
 * Représentation JSON lisible d'un carnet (fichier notebooks/<id>.json des archives .papier).
 * Les points des traits sont encodés en base64 (même binaire que dans Yjs, voir FORMAT.md).
 */
export interface NotebookJson {
  schemaVersion: number;
  title: string;
  pages: (PageData & { elements: JsonElement[] })[];
}

/** Éléments tels qu'écrits dans le JSON : les points des traits passent en base64. */
export type JsonElement = Exclude<PageElement, StrokeElement> | (Omit<StrokeElement, 'points'> & { points: string });

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function docToJson(doc: Y.Doc): NotebookJson {
  const { meta } = roots(doc);
  return {
    schemaVersion: (meta.get('schemaVersion') as number) ?? SCHEMA_VERSION,
    title: (meta.get('title') as string) ?? '',
    pages: listPages(doc).map((page) => ({
      ...page,
      elements: [...(pageElements(doc, page.id)?.values() ?? [])]
        .sort((a, b) => a.z - b.z)
        .map((el): JsonElement => (el.type === 'stroke' ? { ...el, points: bytesToBase64(el.points) } : el)),
    })),
  };
}

/** Reconstruit un document Yjs à partir de sa forme JSON. */
export function jsonToDoc(json: NotebookJson, doc = new Y.Doc()): Y.Doc {
  doc.transact(() => {
    const { meta } = roots(doc);
    meta.set('schemaVersion', SCHEMA_VERSION);
    meta.set('title', json.title);
    json.pages.forEach((p, index) => {
      const { elements, ...page } = p;
      insertPage(doc, page, index);
      addElements(
        doc,
        page.id,
        elements.map((el): PageElement => (el.type === 'stroke' ? { ...el, points: base64ToBytes(el.points) } : el)),
      );
    });
  });
  return doc;
}
