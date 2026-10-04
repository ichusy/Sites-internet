import { putAsset } from '../core/storage/assets';

export interface Sticker {
  id: string;
  label: string;
  svg: string;
}

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`;
const tag = (text: string, fill: string, size = 15) =>
  svg(
    `<rect x="3" y="17" width="58" height="30" rx="8" fill="${fill}"/>` +
      `<text x="32" y="37" font-family="Helvetica, Arial, sans-serif" font-size="${size}" font-weight="700" fill="#fff" text-anchor="middle">${text}</text>`,
  );

/** Autocollants intégrés (dessinés en SVG, convertis en PNG à l'insertion). */
export const STICKERS: Sticker[] = [
  { id: 'star', label: 'Étoile', svg: svg('<path d="M32 5l8 17 18.5 2.3-13.6 12.8 3.6 18.4L32 46.4 15.5 55.5l3.6-18.4L5.5 24.3 24 22z" fill="#f6c343" stroke="#d9a21b" stroke-width="2.5" stroke-linejoin="round"/>') },
  { id: 'heart', label: 'Cœur', svg: svg('<path d="M32 56S6 40 6 22a13 13 0 0 1 26-3 13 13 0 0 1 26 3c0 18-26 34-26 34z" fill="#e5484d"/>') },
  { id: 'check', label: 'Validé', svg: svg('<circle cx="32" cy="32" r="27" fill="#2f9e5a"/><path d="M19 33l9 9 17-19" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>') },
  { id: 'cross', label: 'Faux', svg: svg('<circle cx="32" cy="32" r="27" fill="#d64545"/><path d="M22 22l20 20M42 22L22 42" stroke="#fff" stroke-width="6" stroke-linecap="round"/>') },
  { id: 'warning', label: 'Attention', svg: svg('<path d="M32 6l28 50H4z" fill="#f08c2b" stroke="#f08c2b" stroke-width="4" stroke-linejoin="round"/><path d="M32 24v15" stroke="#fff" stroke-width="6" stroke-linecap="round"/><circle cx="32" cy="47" r="3.5" fill="#fff"/>') },
  { id: 'question', label: 'Question', svg: svg('<circle cx="32" cy="32" r="27" fill="#3461c9"/><path d="M24 25a8 8 0 1 1 12 7c-3 2-4 3.5-4 7" fill="none" stroke="#fff" stroke-width="5.5" stroke-linecap="round"/><circle cx="32" cy="47" r="3.5" fill="#fff"/>') },
  { id: 'idea', label: 'Idée', svg: svg('<path d="M32 6a18 18 0 0 0-10 33c2 1.5 3 4 3 6h14c0-2 1-4.5 3-6A18 18 0 0 0 32 6z" fill="#ffd43b" stroke="#e0a800" stroke-width="2.5"/><rect x="24" y="47" width="16" height="5" rx="2" fill="#8a8f98"/><rect x="26" y="54" width="12" height="5" rx="2.5" fill="#8a8f98"/>') },
  { id: 'arrow', label: 'Flèche', svg: svg('<path d="M6 26h30V13l22 19-22 19V38H6z" fill="#3461c9" stroke="#3461c9" stroke-width="3" stroke-linejoin="round"/>') },
  { id: 'bookmark', label: 'Marque-page', svg: svg('<path d="M16 5h32v54L32 46 16 59z" fill="#7d5ba6"/>') },
  { id: 'flag', label: 'Drapeau', svg: svg('<path d="M14 6v54" stroke="#5b616b" stroke-width="4" stroke-linecap="round"/><path d="M16 8h36l-8 12 8 12H16z" fill="#e5484d"/>') },
  { id: 'pin', label: 'Punaise', svg: svg('<circle cx="32" cy="22" r="15" fill="#e5484d"/><circle cx="27" cy="17" r="5" fill="#ff8d8f"/><path d="M32 37v22" stroke="#5b616b" stroke-width="3.5" stroke-linecap="round"/>') },
  { id: 'smile', label: 'Sourire', svg: svg('<circle cx="32" cy="32" r="27" fill="#ffd43b" stroke="#e0a800" stroke-width="2.5"/><circle cx="23" cy="27" r="3.5" fill="#3a3a3a"/><circle cx="41" cy="27" r="3.5" fill="#3a3a3a"/><path d="M20 38c6 9 18 9 24 0" fill="none" stroke="#3a3a3a" stroke-width="4" stroke-linecap="round"/>') },
  { id: 'review', label: 'À revoir', svg: tag('À revoir', '#f08c2b', 13) },
  { id: 'exam', label: 'Examen', svg: tag('Examen', '#d64545', 14) },
  { id: 'important', label: 'Important', svg: tag('Important', '#7d5ba6', 12) },
  { id: 'definition', label: 'Définition', svg: tag('Déf.', '#3461c9', 16) },
];

export function stickerUrl(s: Sticker) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s.svg)}`;
}

/** Rastérise un autocollant en PNG (256 px) et l'enregistre ; renvoie l'identifiant de fichier. */
export async function stickerAsset(s: Sticker, size = 256): Promise<string> {
  const img = new Image();
  img.src = stickerUrl(s);
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  canvas.getContext('2d')!.drawImage(img, 0, 0, size, size);
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('PNG'))), 'image/png'));
  return putAsset(blob);
}
