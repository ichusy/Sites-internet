import type { PageElement, RecordingData, RecordingSpan } from '../model/types';

/**
 * Correspondance entre l'horloge (horodatage des éléments, ms Unix) et la position
 * dans un fichier audio (secondes). Un enregistrement mis en pause a plusieurs plages.
 */

/** Avance de lecture quand on écoute depuis un trait : on entend la phrase qui l'a amené. */
export const LISTEN_LEAD = 2;

/** Moment où un élément a été posé (ms Unix) : premier point d'un trait, sinon sa valeur z. */
export function elementTime(el: PageElement): number | null {
  const t = el.type === 'stroke' ? el.t0 : el.z;
  // z est un horodatage pour tout élément créé dans Papier (voir nextZ) ; on écarte les valeurs incohérentes.
  return t > 1e12 ? t : null;
}

/** Position (s) dans l'audio d'un instant donné, ou null s'il est hors de l'enregistrement. */
export function audioTimeAt(spans: RecordingSpan[], t: number): number | null {
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    if (t >= s.start && t <= s.end) return s.offset + (t - s.start) / 1000;
    // Pendant une pause : la lecture reprend à la plage suivante.
    const next = spans[i + 1];
    if (next && t > s.end && t < next.start) return next.offset;
  }
  return null;
}

/** Instant (ms Unix) correspondant à une position dans l'audio. */
export function wallTimeAt(spans: RecordingSpan[], sec: number): number | null {
  if (!spans.length) return null;
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    const len = (s.end - s.start) / 1000;
    // À la jonction de deux plages, on retient le début de la suivante (après la pause).
    const inside = i === spans.length - 1 ? sec <= s.offset + len : sec < s.offset + len;
    if (sec >= s.offset && inside) return s.start + (sec - s.offset) * 1000;
  }
  const last = spans[spans.length - 1];
  return sec < spans[0].offset ? spans[0].start : last.end;
}

/** Enregistrement pendant lequel l'instant `t` a eu lieu (le plus récent en cas de chevauchement). */
export function recordingAt(recordings: RecordingData[], t: number): { recording: RecordingData; time: number } | null {
  for (let i = recordings.length - 1; i >= 0; i--) {
    const time = audioTimeAt(recordings[i].spans, t);
    if (time !== null) return { recording: recordings[i], time };
  }
  return null;
}

/** Durée totale des plages (s). */
export function spansDuration(spans: RecordingSpan[]): number {
  return spans.reduce((d, s) => d + (s.end - s.start) / 1000, 0);
}

/** 75 → « 1:15 », 3725 → « 1:02:05 ». */
export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}
