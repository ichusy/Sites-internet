// Build « legacy » : polyfills inclus (Safari/iPadOS et navigateurs pas tout à fait récents).
import type * as PdfJs from 'pdfjs-dist/legacy/build/pdf.mjs';

let lib: Promise<typeof PdfJs> | null = null;

/** Charge pdf.js à la demande (environ 1,7 Mo) : rien n'est téléchargé tant qu'aucun PDF n'est ouvert. */
export function loadPdfjs(): Promise<typeof PdfJs> {
  lib ??= (async () => {
    const [m, worker] = await Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
    ]);
    m.GlobalWorkerOptions.workerSrc = worker.default;
    return m;
  })();
  return lib;
}

/** Ressources annexes de pdf.js (polices standard, CMaps, décodeurs), copiées dans /pdfjs au build. */
function resource(dir: string) {
  return new URL(`pdfjs/${dir}/`, document.baseURI).href;
}

export async function openPdf(data: Uint8Array): Promise<PdfJs.PDFDocumentProxy> {
  const pdfjs = await loadPdfjs();
  // pdf.js transfère le tampon au worker : on lui passe une copie.
  return pdfjs.getDocument({
    data: data.slice(),
    cMapUrl: resource('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: resource('standard_fonts'),
    wasmUrl: resource('wasm'),
    iccUrl: resource('iccs'),
  }).promise;
}
