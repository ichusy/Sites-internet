import * as Y from 'yjs';
import { newId } from './ids';
import type { ID, PageData, PageElement, RecordingData, TemplateRef } from './types';

/**
 * Schéma Yjs d'un carnet (un Y.Doc par carnet) :
 *
 *   meta       Y.Map    { schemaVersion, title }
 *   pageOrder  Y.Array<ID>               ordre des pages
 *   pages      Y.Map<ID, Y.Map>          une Y.Map par page :
 *                 id, width, height, template, background?   (valeurs simples)
 *                 elements: Y.Map<ID, PageElement>          (objets immuables, remplacés en bloc)
 *   recordings Y.Map<ID, RecordingData>  enregistrements audio (hors historique d'annulation)
 */

/** v2 : crayon, formes, texte, images, modèles Cornell/planner/importés (rétrocompatible avec v1). */
export const SCHEMA_VERSION = 2;

/** Origine des transactions locales : seules celles-ci sont annulables par l'utilisateur. */
export const LOCAL_ORIGIN = { name: 'local' };

export type PageMap = Y.Map<unknown>;
export type ElementsMap = Y.Map<PageElement>;

export function roots(doc: Y.Doc) {
  return {
    meta: doc.getMap<unknown>('meta'),
    pageOrder: doc.getArray<ID>('pageOrder'),
    pages: doc.getMap<PageMap>('pages'),
    recordings: doc.getMap<RecordingData>('recordings'),
  };
}

/** Enregistrements du carnet, du plus ancien au plus récent. */
export function listRecordings(doc: Y.Doc): RecordingData[] {
  return [...roots(doc).recordings.values()].sort((a, b) => a.createdAt - b.createdAt);
}

export function putRecording(doc: Y.Doc, rec: RecordingData) {
  roots(doc).recordings.set(rec.id, rec);
}

export function deleteRecording(doc: Y.Doc, id: ID) {
  roots(doc).recordings.delete(id);
}

export function initNotebook(doc: Y.Doc, title: string, firstPage: Omit<PageData, 'id'>) {
  const { meta, pageOrder } = roots(doc);
  if (pageOrder.length > 0) return;
  doc.transact(() => {
    meta.set('schemaVersion', SCHEMA_VERSION);
    meta.set('title', title);
    insertPage(doc, { ...firstPage, id: newId() }, 0);
  });
}

function createPageMap(page: PageData): PageMap {
  const map = new Y.Map<unknown>();
  map.set('id', page.id);
  map.set('width', page.width);
  map.set('height', page.height);
  map.set('template', { ...page.template });
  if (page.background) map.set('background', { ...page.background });
  if (page.infinite) map.set('infinite', true);
  map.set('elements', new Y.Map<PageElement>());
  return map;
}

export function readPage(map: PageMap): PageData {
  const page: PageData = {
    id: map.get('id') as ID,
    width: map.get('width') as number,
    height: map.get('height') as number,
    template: map.get('template') as TemplateRef,
  };
  const bg = map.get('background') as PageData['background'];
  if (bg) page.background = bg;
  if (map.get('infinite')) page.infinite = true;
  return page;
}

export function pageElements(doc: Y.Doc, pageId: ID): ElementsMap | undefined {
  return roots(doc).pages.get(pageId)?.get('elements') as ElementsMap | undefined;
}

export function listPages(doc: Y.Doc): PageData[] {
  const { pageOrder, pages } = roots(doc);
  const out: PageData[] = [];
  for (const id of pageOrder.toArray()) {
    const map = pages.get(id);
    if (map) out.push(readPage(map));
  }
  return out;
}

/** Insère une page à l'index donné. À appeler dans une transaction. */
export function insertPage(doc: Y.Doc, page: PageData, index: number) {
  const { pageOrder, pages } = roots(doc);
  pages.set(page.id, createPageMap(page));
  pageOrder.insert(Math.max(0, Math.min(index, pageOrder.length)), [page.id]);
}

export function deletePage(doc: Y.Doc, pageId: ID) {
  const { pageOrder, pages } = roots(doc);
  const index = pageOrder.toArray().indexOf(pageId);
  if (index >= 0) pageOrder.delete(index, 1);
  pages.delete(pageId);
}

export function movePage(doc: Y.Doc, from: number, to: number) {
  const { pageOrder } = roots(doc);
  if (from === to || from < 0 || from >= pageOrder.length) return;
  const id = pageOrder.get(from);
  pageOrder.delete(from, 1);
  pageOrder.insert(Math.max(0, Math.min(to, pageOrder.length)), [id]);
}

/** Duplique une page (éléments compris) juste après l'original. Renvoie l'id de la copie. */
export function duplicatePage(doc: Y.Doc, pageId: ID): ID | null {
  const { pageOrder, pages } = roots(doc);
  const src = pages.get(pageId);
  if (!src) return null;
  const copy: PageData = { ...readPage(src), id: newId() };
  insertPage(doc, copy, pageOrder.toArray().indexOf(pageId) + 1);
  const srcEls = src.get('elements') as ElementsMap;
  const dstEls = pageElements(doc, copy.id)!;
  srcEls.forEach((el) => {
    const id = newId();
    dstEls.set(id, el.type === 'stroke' ? { ...el, id, points: el.points.slice() } : { ...el, id });
  });
  return copy.id;
}

export function setPageTemplate(doc: Y.Doc, pageId: ID, template: TemplateRef) {
  roots(doc).pages.get(pageId)?.set('template', { ...template });
}

export function addElements(doc: Y.Doc, pageId: ID, elements: PageElement[]) {
  const els = pageElements(doc, pageId);
  if (!els) return;
  for (const el of elements) els.set(el.id, el);
}

export function removeElements(doc: Y.Doc, pageId: ID, ids: Iterable<ID>) {
  const els = pageElements(doc, pageId);
  if (!els) return;
  for (const id of ids) els.delete(id);
}
